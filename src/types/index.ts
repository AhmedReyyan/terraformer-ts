export interface TerraformResource {
  id: string;
  type: string;
  name: string;
  provider: string;
  attributes: Record<string, any>;
  dependencies?: string[];
  ignoreKeys?: string[];
  allowEmptyValues?: string[];
  additionalFields?: Record<string, any>;
  dataFiles?: Record<string, Buffer>;
}

export interface ResourceFilter {
  serviceName?: string;
  fieldPath: string;
  acceptableValues?: string[];
  isApplicable: (resourceName: string) => boolean;
}

export interface ImportOptions {
  resources: string[];
  excludes?: string[];
  pathPattern?: string;
  pathOutput?: string;
  state?: 'local' | 'remote';
  bucket?: string;
  profile?: string;
  verbose?: boolean;
  region?: string;
  regions?: string[];
  projects?: string[];
  resourceGroup?: string;
  connect?: boolean;
  compact?: boolean;
  filters?: string[];
  output?: 'hcl' | 'json';
  noSort?: boolean;
  retryCount?: number;
  retrySleepMs?: number;
}

export interface ProviderConfig {
  region?: string;
  profile?: string;
  credentials?: {
    accessKeyId?: string;
    secretAccessKey?: string;
    sessionToken?: string;
  };
  [key: string]: any;
}

export interface ServiceConfig {
  name: string;
  provider: string;
  resources: TerraformResource[];
  filters: ResourceFilter[];
  verbose: boolean;
  args: Record<string, any>;
}

export interface ResourceConnection {
  [resourceType: string]: {
    [fieldName: string]: string[];
  };
}

export interface ProviderData {
  provider: {
    [providerName: string]: any;
  };
  terraform?: {
    required_providers: Array<{
      [providerName: string]: {
        source?: string;
        version?: string;
      };
    }>;
  };
}

export interface HclOutput {
  resources: Record<string, any>;
  provider: ProviderData;
  terraform?: any;
}

export interface ImportPlan {
  version: string;
  provider: string;
  options: ImportOptions;
  args: string[];
  importedResources: Record<string, TerraformResource[]>;
}

export interface LogLevel {
  ERROR: 'error';
  WARN: 'warn';
  INFO: 'info';
  DEBUG: 'debug';
}

export type LogLevelType = LogLevel[keyof LogLevel];

export interface Logger {
  error(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
}

export interface ProgressCallback {
  (message: string, current: number, total: number): void;
}

export interface ErrorWithCode extends Error {
  code: string;
  provider?: string;
  service?: string;
  resource?: string;
}
