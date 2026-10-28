import { DefaultAzureCredential, TokenCredential } from '@azure/identity';
import { ResourceManagementClient } from '@azure/arm-resources';
import { BaseService } from '../../core/provider';
import { ProviderConfig } from '../../types';
import { ArmResource, ArmMapping, findMapping, mappingsFor, namespaceOwner } from './arm-types';
import { idKey, normalizeArmId, parseArmId, resourceGroupOf } from './arm-id';

export interface ResourceGroupInfo {
  id: string;
  name: string;
  location?: string;
  managedBy?: string;
  tags?: Record<string, string>;
}

/** Everything the generic ARM listing returned for one subscription (shared by all services). */
export interface ArmInventory {
  resourceGroups: ResourceGroupInfo[];
  resources: ArmResource[];
  /** Lowercase names of resource groups managed by another resource (AKS node RG, Databricks, ...). */
  managedGroups: Set<string>;
}

const credentials = new WeakMap<ProviderConfig, TokenCredential>();
const inventories = new WeakMap<ProviderConfig, Promise<ArmInventory>>();

/** One DefaultAzureCredential (env vars, Azure CLI, managed identity, ...) per provider config. */
export function azureCredential(config: ProviderConfig): TokenCredential {
  let credential = credentials.get(config);
  if (!credential) {
    credential = config.credential as TokenCredential | undefined || new DefaultAzureCredential();
    credentials.set(config, credential);
  }
  return credential;
}

/** List resource groups and resources once per provider config (all services share the result). */
export function armInventory(config: ProviderConfig): Promise<ArmInventory> {
  let inventory = inventories.get(config);
  if (!inventory) {
    inventory = loadInventory(config);
    inventories.set(config, inventory);
    // Do not cache failures: a later service may succeed.
    inventory.catch(() => inventories.delete(config));
  }
  return inventory;
}

async function loadInventory(config: ProviderConfig): Promise<ArmInventory> {
  const subscriptionId = requireSubscription(config);
  const filter = (config.resourceGroup as string | undefined)?.toLowerCase();
  const client = new ResourceManagementClient(azureCredential(config), subscriptionId);

  const resourceGroups: ResourceGroupInfo[] = [];
  for await (const group of client.resourceGroups.list()) {
    if (!group.id || !group.name || (filter && group.name.toLowerCase() !== filter)) {
      continue;
    }
    resourceGroups.push({ id: group.id, name: group.name, location: group.location, managedBy: group.managedBy, tags: group.tags });
  }

  const resources: ArmResource[] = [];
  const listing = filter ? client.resources.listByResourceGroup(config.resourceGroup) : client.resources.list();
  for await (const item of listing) {
    if (!item.id || !item.type) {
      continue;
    }
    resources.push({
      id: item.id,
      type: item.type,
      name: item.name || item.id.split('/').pop() || item.id,
      kind: item.kind,
      location: item.location,
      managedBy: item.managedBy,
      sku: item.sku ? { name: item.sku.name, tier: item.sku.tier } : undefined,
      tags: item.tags
    });
  }

  const managedGroups = new Set(resourceGroups.filter(group => group.managedBy).map(group => group.name.toLowerCase()));
  return { resourceGroups, resources, managedGroups };
}

function requireSubscription(config: ProviderConfig): string {
  const subscriptionId = config.subscriptionId as string | undefined;
  if (!subscriptionId) {
    throw new Error('No Azure subscription configured (pass --subscription or set ARM_SUBSCRIPTION_ID)');
  }
  return subscriptionId;
}

type AzureClientConstructor<T> = new (credential: TokenCredential, subscriptionId: string) => T;

/**
 * Base class for Azure services. Resources are registered with `this.add(type, importId, ...)`;
 * every import ID is an ARM resource ID normalized to the casing of the azurerm import docs.
 */
export abstract class AzureService extends BaseService {
  /** Unmapped ARM types seen by this service run: type -> count. */
  private unsupported = new Map<string, number>();

  protected get subscriptionId(): string {
    return requireSubscription(this.config);
  }

  /** The `--resource-group` filter, if any. */
  protected get resourceGroup(): string | undefined {
    return this.config.resourceGroup || undefined;
  }

  protected client<T>(ClientClass: AzureClientConstructor<T>): T {
    return new ClientClass(azureCredential(this.config), this.subscriptionId);
  }

  protected inventory(): Promise<ArmInventory> {
    return armInventory(this.config);
  }

  /** True when the ID is inside the configured resource group (or no filter is set). */
  protected inScope(id: string): boolean {
    const filter = this.resourceGroup;
    return !filter || (resourceGroupOf(id) || '').toLowerCase() === filter.toLowerCase();
  }

  /**
   * Why a resource must not be imported, or undefined. Rules:
   * - it lives in a resource group managed by another resource (AKS `MC_*` node resource group,
   *   Databricks/Synapse managed resource groups, ...): those objects are owned by that resource;
   * - its own `managedBy` is set (owned by another resource, e.g. a managed application).
   */
  protected skipReason(inventory: ArmInventory, id: string, managedBy?: string): string | undefined {
    if (!this.inScope(id)) {
      return 'outside the selected resource group';
    }
    const group = (resourceGroupOf(id) || '').toLowerCase();
    if (inventory.managedGroups.has(group)) {
      return `resource group ${resourceGroupOf(id)} is managed by another resource`;
    }
    if (managedBy) {
      return `managed by ${managedBy}`;
    }
    return undefined;
  }

  /** Add an ARM resource: the import ID is the resource ID in the documented casing. */
  protected addArm(type: string, id: string, armType: string, info: Partial<ArmResource> = {}): void {
    const parsed = parseArmId(id);
    const name = parsed?.names.length ? parsed.names.join('-') : info.name || id;
    const attributes: Record<string, any> = { name: parsed?.names[parsed.names.length - 1] || info.name };
    if (parsed?.resourceGroup) attributes.resource_group = parsed.resourceGroup;
    if (info.location) attributes.location = info.location;
    if (info.kind) attributes.kind = info.kind;
    if (info.tags && Object.keys(info.tags).length > 0) attributes.tags = { ...info.tags };
    this.add(type, normalizeArmId(id, armType), name, attributes);
  }

  /**
   * Import every resource of the generic listing that this service maps (except `custom`
   * mappings, which the service imports itself). `exclude` holds lowercase IDs to skip.
   */
  protected async importMapped(inventory: ArmInventory, exclude: Set<string> = new Set()): Promise<void> {
    for (const resource of inventory.resources) {
      const mapping = findMapping(resource.type);
      if (!mapping) {
        if (namespaceOwner(resource.type) === this.serviceName && !this.skipReason(inventory, resource.id, resource.managedBy)) {
          this.unsupportedType(resource.type, resource.id);
        }
        continue;
      }
      if (mapping.service !== this.serviceName || mapping.custom || exclude.has(idKey(resource.id))) {
        continue;
      }
      this.importResource(inventory, mapping, resource);
    }
  }

  protected importResource(inventory: ArmInventory, mapping: ArmMapping, resource: ArmResource): void {
    const reason = this.skipReason(inventory, resource.id, resource.managedBy) || mapping.skip?.(resource);
    if (reason) {
      this.log(`Skipping ${resource.id}: ${reason}`, 'debug');
      return;
    }
    const type = typeof mapping.terraformType === 'function' ? mapping.terraformType(resource) : mapping.terraformType;
    if (!type) {
      this.unsupportedType(`${mapping.armType} (${describeVariant(resource)})`, resource.id);
      return;
    }
    this.addArm(type, resource.id, mapping.armType, resource);
  }

  /** Record a resource without an azurerm equivalent (debug per resource, summary at the end). */
  protected unsupportedType(label: string, id: string): void {
    this.log(`No azurerm resource type for ${label}: ${id}`, 'debug');
    this.unsupported.set(label, (this.unsupported.get(label) || 0) + 1);
  }

  /** One info line per service run listing the unsupported ARM types that were not imported. */
  protected reportUnsupported(): void {
    if (this.unsupported.size === 0) {
      return;
    }
    const total = [...this.unsupported.values()].reduce((sum, count) => sum + count, 0);
    const types = [...this.unsupported.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([type, count]) => `${type} (${count})`);
    this.logger.info(
      `[${this.providerName}:${this.serviceName}] ${total} resource(s) of ${types.length} unsupported ARM type(s) not imported: ${types.join(', ')}`
    );
  }

  /** Mappings owned by this service (for tests and documentation). */
  protected mappings(): ArmMapping[] {
    return mappingsFor(this.serviceName);
  }
}

function describeVariant(resource: ArmResource): string {
  const parts: string[] = [];
  if (resource.kind) parts.push(`kind=${resource.kind}`);
  if (resource.sku?.name) parts.push(`sku=${resource.sku.name}`);
  return parts.join(', ') || 'unsupported variant';
}

/** A service that only imports the generic-listing mappings of its key (see arm-types.ts). */
export class MappedService extends AzureService {
  async initResources(): Promise<void> {
    await this.collect('resources', async () => {
      await this.importMapped(await this.inventory());
    });
    this.reportUnsupported();
  }
}
