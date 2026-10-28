import { BaseService } from '../../core/provider';
import { ProviderConfig } from '../../types';
import { fromIni } from '@aws-sdk/credential-providers';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';

type AwsClientConstructor<T> = new (config: any) => T;

const credentialProviders = new WeakMap<ProviderConfig, unknown>();
const accountIds = new WeakMap<ProviderConfig, Promise<string>>();

export const DEFAULT_REGION = 'us-east-1';

/**
 * Base class for AWS services. Subclasses implement `initResources()` and register
 * resources with `this.add(type, importId, name, attributes)`; each `add` becomes an
 * `import` block, so `importId` must be exactly the ID documented in the
 * "Import" section of the Terraform AWS provider docs for that resource type.
 */
export abstract class AwsService extends BaseService {
  /** The region API calls are made in ("aws-global" is an alias for us-east-1). */
  protected get region(): string {
    const region = this.config.region;
    return !region || region === 'aws-global' ? DEFAULT_REGION : region;
  }

  /** Create an SDK v3 client configured with this provider's region, credentials and retries. */
  protected client<T>(ClientClass: AwsClientConstructor<T>, region: string = this.region): T {
    return new ClientClass({
      region,
      credentials: awsCredentials(this.config),
      maxAttempts: 8,
      retryMode: 'adaptive'
    });
  }

  /** The AWS account ID of the caller (cached per provider configuration). */
  protected accountId(): Promise<string> {
    let accountId = accountIds.get(this.config);
    if (!accountId) {
      accountId = this.client(STSClient)
        .send(new GetCallerIdentityCommand({}))
        .then(response => {
          if (!response.Account) {
            throw new Error('sts:GetCallerIdentity returned no account ID');
          }
          return response.Account;
        });
      accountIds.set(this.config, accountId);
      // Do not cache failures: a later call may succeed.
      accountId.catch(() => accountIds.delete(this.config));
    }
    return accountId;
  }
}

/** Resolve credentials: explicit keys, then a named profile, then the SDK default chain. */
export function awsCredentials(config: ProviderConfig): any {
  if (config.credentials?.accessKeyId && config.credentials.secretAccessKey) {
    return {
      accessKeyId: config.credentials.accessKeyId,
      secretAccessKey: config.credentials.secretAccessKey,
      sessionToken: config.credentials.sessionToken || undefined
    };
  }
  if (config.profile && config.profile !== 'default') {
    let provider = credentialProviders.get(config);
    if (!provider) {
      provider = fromIni({ profile: config.profile });
      credentialProviders.set(config, provider);
    }
    return provider;
  }
  return undefined;
}

/**
 * Await an API call that fails with a "not found" error when the optional
 * configuration does not exist (S3 bucket policy, lifecycle, ...). Returns
 * undefined in that case and rethrows every other error.
 */
export async function optional<T>(call: Promise<T>): Promise<T | undefined> {
  try {
    return await call;
  } catch (error) {
    if (isNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

export function isNotFound(error: unknown): boolean {
  const e = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  const name = e?.name || e?.Code || '';
  return e?.$metadata?.httpStatusCode === 404 || /NotFound|NoSuch|DoesNotExist/i.test(name);
}

/** Convert an AWS tag list (`[{ Key, Value }]`) to a map. */
export function tagMap(tags?: Array<{ Key?: string; Value?: string }> | Record<string, string>): Record<string, string> {
  if (!tags) {
    return {};
  }
  if (!Array.isArray(tags)) {
    return { ...tags };
  }
  const map: Record<string, string> = {};
  for (const tag of tags) {
    if (tag.Key !== undefined) {
      map[tag.Key] = tag.Value ?? '';
    }
  }
  return map;
}

/** The `Name` tag if present, otherwise the fallback. Used for readable resource names. */
export function nameTag(tags: Array<{ Key?: string; Value?: string }> | undefined, fallback: string): string {
  const name = tags?.find(tag => tag.Key === 'Name')?.Value;
  return name ? name : fallback;
}

/** The last segment of an ARN resource part, e.g. the function name of a Lambda ARN. */
export function arnResourceName(arn: string): string {
  return arn.split(/[:/]/).pop() || arn;
}
