import { 
  TerraformResource, 
  ImportOptions, 
  ProviderConfig, 
  ServiceConfig, 
  ResourceConnection,
  ProviderData,
  Logger 
} from '../types';

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
  protected providerName: string;
  protected serviceName: string;
  protected config: ProviderConfig;
  protected logger: Logger;
  protected resources: TerraformResource[] = [];
  protected verbose: boolean = false;
  protected args: Record<string, any> = {};

  constructor(providerName: string, serviceName: string, config: ProviderConfig, logger: Logger) {
    this.providerName = providerName;
    this.serviceName = serviceName;
    this.config = config;
    this.logger = logger;
  }

  abstract initResources(): Promise<void>;
  abstract parseFilter(rawFilter: string): import('../types').ResourceFilter[];
  abstract postConvertHook(): Promise<void>;

  getResources(): TerraformResource[] {
    return this.resources;
  }

  setResources(resources: TerraformResource[]): void {
    this.resources = resources;
  }

  addResource(resource: TerraformResource): void {
    this.resources.push(resource);
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

  protected createResource(
    id: string,
    name: string,
    type: string,
    attributes: Record<string, any> = {},
    additionalFields: Record<string, any> = {}
  ): TerraformResource {
    return {
      id,
      type: `${this.providerName}_${type}`,
      name: this.sanitizeName(name),
      provider: this.providerName,
      attributes,
      additionalFields
    };
  }

  protected sanitizeName(name: string): string {
    // Convert to valid Terraform resource name
    return name
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/^[0-9]/, '_$&')
      .toLowerCase();
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
