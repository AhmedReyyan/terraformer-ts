import {
  TerraformResource,
  ProviderConfig,
  ResourceConnection,
  ResourceFilter,
  ProviderData,
  Logger
} from '../types';
import { parseFilter } from './filter';
import { sanitizeResourceName } from './naming';

export abstract class BaseProvider {
  protected config: ProviderConfig;
  protected logger: Logger;
  protected name: string;

  constructor(name: string, config: ProviderConfig, logger: Logger) {
    this.name = name;
    this.config = config;
    this.logger = logger;
  }

  abstract init(args: string[]): Promise<void>;
  abstract getSupportedServices(): Record<string, typeof BaseService>;
  abstract getResourceConnections(): ResourceConnection;
  abstract getProviderData(): ProviderData;
  abstract getConfig(): Record<string, any>;

  getName(): string {
    return this.name;
  }

  getConfigValue(): ProviderConfig {
    return this.config;
  }

  /**
   * The scope currently being imported (AWS region, GCP project, Azure subscription).
   * Used for the `{region}` placeholder in path patterns.
   */
  getScope(): string {
    return this.config.region || 'default';
  }

  /**
   * Environment variables the terraform CLI needs to authenticate the same way
   * this provider did (e.g. explicit credentials passed programmatically).
   */
  getTerraformEnv(): Record<string, string> {
    return {};
  }

  /** Global services are imported only once, even when several regions are requested. */
  isGlobalService(serviceName: string): boolean {
    const ServiceClass = this.getSupportedServices()[serviceName] as any;
    return Boolean(ServiceClass?.global);
  }

  async initService(serviceName: string, verbose: boolean): Promise<BaseService> {
    const supportedServices = this.getSupportedServices();
    const ServiceClass = supportedServices[serviceName];

    if (!ServiceClass) {
      throw new Error(`${this.name}: ${serviceName} not supported service`);
    }

    const service = new (ServiceClass as any)(this.name, serviceName, this.config, this.logger);
    service.setVerbose(verbose);
    return service;
  }
}

export abstract class BaseService {
  /** Set to true on services whose resources are not regional (IAM, Route53, ...). */
  static readonly global: boolean = false;

  protected providerName: string;
  protected serviceName: string;
  protected config: ProviderConfig;
  protected logger: Logger;
  protected resources: TerraformResource[] = [];
  protected warnings: string[] = [];
  protected verbose: boolean = false;
  protected args: Record<string, any> = {};

  constructor(providerName: string, serviceName: string, config: ProviderConfig, logger: Logger) {
    this.providerName = providerName;
    this.serviceName = serviceName;
    this.config = config;
    this.logger = logger;
  }

  abstract initResources(): Promise<void>;

  parseFilter(rawFilter: string): ResourceFilter[] {
    return parseFilter(rawFilter);
  }

  async postConvertHook(): Promise<void> {}

  getResources(): TerraformResource[] {
    return this.resources;
  }

  setResources(resources: TerraformResource[]): void {
    this.resources = resources;
  }

  addResource(resource: TerraformResource): void {
    this.resources.push(resource);
  }

  getWarnings(): string[] {
    return this.warnings;
  }

  getServiceName(): string {
    return this.serviceName;
  }

  setVerbose(verbose: boolean): void {
    this.verbose = verbose;
  }

  isVerbose(): boolean {
    return this.verbose;
  }

  setArgs(args: Record<string, any>): void {
    this.args = args;
  }

  getArgs(): Record<string, any> {
    return this.args;
  }

  getProviderName(): string {
    return this.providerName;
  }

  /**
   * Create a resource. `id` must be the import ID documented for `type` in the
   * Terraform provider. `type` may be given with or without the provider prefix.
   */
  protected createResource(
    id: string,
    name: string,
    type: string,
    attributes: Record<string, any> = {},
    additionalFields: Record<string, any> = {}
  ): TerraformResource {
    const fullType = type.startsWith(`${this.providerName}_`) ? type : `${this.providerName}_${type}`;
    return {
      id,
      type: fullType,
      name: this.sanitizeName(name),
      provider: this.providerName,
      service: this.serviceName,
      region: this.config.region,
      attributes,
      additionalFields
    };
  }

  /** Shorthand for createResource + addResource. */
  protected add(type: string, id: string, name: string, attributes: Record<string, any> = {}): TerraformResource {
    const resource = this.createResource(id, name || id, type, attributes);
    this.addResource(resource);
    return resource;
  }

  /**
   * Run one discovery step. Failures (missing permissions, service not available
   * in the region, ...) are recorded as warnings so the rest of the service still imports.
   */
  protected async collect(label: string, fn: () => Promise<void>): Promise<void> {
    const before = this.resources.length;
    try {
      this.log(`Loading ${label}...`, 'debug');
      await fn();
      this.log(`Loaded ${this.resources.length - before} ${label}`, 'debug');
    } catch (error) {
      this.warn(`${label}: ${describeError(error)}`);
    }
  }

  /** Record a non-fatal problem. Warnings are logged and listed in the import summary. */
  protected warn(message: string): void {
    this.warnings.push(`[${this.providerName}:${this.serviceName}] ${message}`);
    this.log(message, 'warn');
  }

  protected sanitizeName(name: string): string {
    return sanitizeResourceName(name);
  }

  protected async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  protected log(message: string, level: 'info' | 'debug' | 'warn' | 'error' = 'info'): void {
    if (this.verbose || level === 'error' || level === 'warn') {
      this.logger[level](`[${this.providerName}:${this.serviceName}] ${message}`);
    }
  }
}

export function describeError(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { name?: string; code?: string; message?: string };
    const kind = e.name && e.name !== 'Error' ? e.name : e.code;
    const message = e.message || String(error);
    return kind && !message.startsWith(kind) ? `${kind}: ${message}` : message;
  }
  return String(error);
}

/** Map over items with at most `limit` promises in flight. Results keep input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
