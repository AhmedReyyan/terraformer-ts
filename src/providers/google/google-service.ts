import { AssetServiceClient, protos } from '@google-cloud/asset';
import { BaseService, describeError } from '../../core/provider';
import { ProviderConfig } from '../../types';

type SearchResult = protos.google.cloud.asset.v1.IResourceSearchResult;
type Struct = protos.google.protobuf.IStruct;
type Value = protos.google.protobuf.IValue;

/** A Cloud Asset Inventory search result, normalized for the mapping rules. */
export interface GoogleAsset {
  assetType: string;
  /** Full resource name, e.g. `//compute.googleapis.com/projects/p/zones/z/instances/i`. */
  name: string;
  /**
   * The name without the `//service.googleapis.com/` prefix, with a leading
   * `projects/<number>` replaced by `projects/<project id>` (several services
   * name their assets with the project number).
   */
  path: string;
  displayName: string;
  description: string;
  location: string;
  state: string;
  labels: Record<string, string>;
  /** `additionalAttributes` converted from a protobuf Struct to plain JSON. */
  attributes: Record<string, unknown>;
}

/**
 * Maps one asset type (and name shape) to a Terraform resource type. `path` is
 * matched against `GoogleAsset.path`; each `*` matches one path segment and is
 * passed to `id` / `name` in `m` (m[0] is the whole path).
 */
export interface AssetRule {
  assetType: string;
  path: string;
  type: string;
  /** The documented import ID. Defaults to the asset path. Return undefined to skip. */
  id?: (m: string[], asset: GoogleAsset) => string | undefined;
  /** Resource name. Defaults to the last path segment. */
  name?: (m: string[], asset: GoogleAsset) => string;
}

interface CompiledRule extends AssetRule {
  regex: RegExp;
}

/**
 * Label keys Google sets on resources that another service creates and owns
 * (Cloud Run services of 2nd gen functions, Composer and Dataproc buckets/VMs, ...).
 */
export const OWNER_LABELS = ['goog-managed-by', 'goog-composer-environment', 'goog-dataproc-cluster-name'];

const clients = new WeakMap<ProviderConfig, AssetServiceClient>();

/** States in which a resource is going away and must not be imported. */
const GONE_STATES = /^(DELETING|DELETED|DELETE_REQUESTED|DELETE_IN_PROGRESS|PENDING_DELETE|DESTROYED|DESTROY_SCHEDULED|TERMINATING)$/i;

/**
 * Base class for Google Cloud services. Resources are discovered with one Cloud
 * Asset Inventory search per service (`searchAllResources`, all pages) and
 * converted to import blocks by the service's `rules`.
 */
export abstract class GoogleService extends BaseService {
  protected abstract readonly rules: AssetRule[];

  /** Assets carrying one of these label keys are skipped (see OWNER_LABELS). */
  protected readonly ownerLabels: string[] = OWNER_LABELS;

  protected get project(): string {
    const project = this.config.project;
    if (!project) {
      throw new Error('google: no project configured');
    }
    return project;
  }

  /** Called with every asset found before conversion (for skip rules that need other assets). */
  protected prepare(assets: GoogleAsset[]): void {}

  /** Return a reason to skip the asset, or undefined to import it. */
  protected skip(asset: GoogleAsset): string | undefined {
    return undefined;
  }

  async initResources(): Promise<void> {
    const rules: CompiledRule[] = this.rules.map(rule => ({ ...rule, regex: compilePath(rule.path) }));
    const assetTypes = [...new Set(rules.map(rule => rule.assetType))];

    await this.collect(`${this.serviceName} assets`, async () => {
      const assets = await this.searchAssets(assetTypes);
      if (!assets) {
        return;
      }
      this.prepare(assets);
      for (const asset of assets) {
        const reason = this.baseSkip(asset) || this.skip(asset);
        if (reason) {
          this.log(`Skipping ${asset.name}: ${reason}`, 'debug');
          continue;
        }
        this.convert(asset, rules);
      }
    });
  }

  private convert(asset: GoogleAsset, rules: CompiledRule[]): void {
    for (const rule of rules) {
      if (rule.assetType !== asset.assetType) {
        continue;
      }
      const match = rule.regex.exec(asset.path);
      if (!match) {
        continue;
      }
      const m = Array.from(match);
      const id = rule.id ? rule.id(m, asset) : asset.path;
      if (!id) {
        return;
      }
      const name = rule.name ? rule.name(m, asset) : lastSegment(asset.path);
      const attributes: Record<string, unknown> = {
        name: lastSegment(asset.path),
        asset_name: asset.name
      };
      if (asset.location) {
        attributes.location = asset.location;
      }
      if (Object.keys(asset.labels).length > 0) {
        attributes.tags = asset.labels;
      }
      this.add(rule.type, id, name, attributes);
      return;
    }
    this.log(`No mapping for ${asset.assetType} ${asset.name}`, 'debug');
  }

  private baseSkip(asset: GoogleAsset): string | undefined {
    if (GONE_STATES.test(asset.state)) {
      return `state ${asset.state}`;
    }
    const owner = this.ownerLabels.find(key => key in asset.labels);
    return owner ? `created and managed by Google (label ${owner})` : undefined;
  }

  /**
   * Search all assets of the given types in the project. Returns undefined (after
   * recording a warning) when the Cloud Asset API cannot be used.
   */
  protected async searchAssets(assetTypes: string[]): Promise<GoogleAsset[] | undefined> {
    const client = assetClient(this.config);
    const assets: GoogleAsset[] = [];
    try {
      const iterable = client.searchAllResourcesAsync({
        scope: `projects/${this.project}`,
        assetTypes,
        pageSize: 500
      });
      for await (const result of iterable) {
        assets.push(normalizeAsset(result, this.project));
      }
    } catch (error) {
      const hint = cloudAssetHint(error, this.project);
      if (!hint) {
        throw error;
      }
      this.warn(hint);
      return undefined;
    }
    return assets;
  }
}

export function assetClient(config: ProviderConfig): AssetServiceClient {
  let client = clients.get(config);
  if (!client) {
    client = new AssetServiceClient();
    clients.set(config, client);
  }
  return client;
}

/** A user-facing explanation for errors caused by the Cloud Asset API setup, else undefined. */
export function cloudAssetHint(error: unknown, project: string): string | undefined {
  const text = describeError(error) + ' ' + String((error as { reason?: string })?.reason ?? '');
  if (/SERVICE_DISABLED|has not been used in project|API .*is disabled|it is disabled/i.test(text)) {
    return `The Cloud Asset API is not enabled in project ${project}, so no resources could be discovered. ` +
      `Enable it with: gcloud services enable cloudasset.googleapis.com --project ${project}`;
  }
  if (/quota project/i.test(text)) {
    return `The Cloud Asset API requires a quota project when using user credentials. ` +
      `Run: gcloud auth application-default set-quota-project ${project}`;
  }
  if (/PERMISSION_DENIED|cloudasset\.assets\.searchAllResources/i.test(text)) {
    return `Permission denied searching resources in project ${project}: the caller needs ` +
      `cloudasset.assets.searchAllResources (e.g. roles/cloudasset.viewer). ${describeError(error)}`;
  }
  return undefined;
}

export function normalizeAsset(result: SearchResult, project: string): GoogleAsset {
  const name = result.name || '';
  return {
    assetType: result.assetType || '',
    name,
    path: assetPath(name, project),
    displayName: result.displayName || '',
    description: result.description || '',
    location: result.location || '',
    state: result.state || '',
    labels: { ...(result.labels || {}) },
    attributes: structToJson(result.additionalAttributes)
  };
}

/** `//svc.googleapis.com/projects/123/x/y` -> `projects/<project>/x/y`. */
export function assetPath(name: string, project: string): string {
  const path = name.replace(/^\/\/[^/]+\//, '');
  return path.replace(/^projects\/[^/]+(?=\/|$)/, `projects/${project}`);
}

export function structToJson(struct: Struct | null | undefined): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(struct?.fields || {})) {
    result[key] = valueToJson(value);
  }
  return result;
}

function valueToJson(value: Value): unknown {
  // Decoded protobuf messages expose the set member of the `kind` oneof.
  const kind = (value as { kind?: string }).kind;
  if (kind === 'structValue') return structToJson(value.structValue);
  if (kind === 'listValue') return (value.listValue?.values || []).map(valueToJson);
  if (kind === 'nullValue') return null;
  if (kind) return (value as Record<string, unknown>)[kind];
  if (value.stringValue !== undefined && value.stringValue !== null) return value.stringValue;
  if (value.numberValue !== undefined && value.numberValue !== null) return value.numberValue;
  if (value.boolValue !== undefined && value.boolValue !== null) return value.boolValue;
  if (value.structValue) return structToJson(value.structValue);
  if (value.listValue) return (value.listValue.values || []).map(valueToJson);
  return null;
}

function compilePath(path: string): RegExp {
  const parts = path.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${parts.join('([^/]+)')}$`);
}

export function lastSegment(path: string): string {
  const segments = path.split('/');
  return segments[segments.length - 1];
}

/** `us-central1-a` -> `us-central1`. */
export function zoneRegion(zone: string): string {
  return zone.replace(/-[a-z]$/, '');
}
