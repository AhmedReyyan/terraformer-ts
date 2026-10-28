export interface TerraformResource {
  /** The ID passed to Terraform's `import` block (the provider-specific import ID). */
  id: string;
  /** Full Terraform resource type, e.g. `aws_s3_bucket`. */
  type: string;
  /** Terraform resource name (the second label of the resource block). */
  name: string;
  provider: string;
  /** Metadata discovered from the cloud API. Used for filtering and written to inventory.json. */
  attributes: Record<string, any>;
  /** The terraformer service that discovered this resource, e.g. `s3`. */
  service?: string;
  /** The scope (AWS region, GCP project, Azure subscription) the resource was discovered in. */
  region?: string;
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
  /**
   * Run `terraform init` + `terraform plan -generate-config-out` in every output
   * directory to produce full resource configuration. Defaults to true when a
   * Terraform >= 1.5 binary is available.
   */
  generate?: boolean;
  /** Path to the terraform binary. Defaults to `terraform` on PATH. */
  terraformBin?: string;
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

export interface ImportResult {
  /** All resources that were written to import blocks. */
  resources: TerraformResource[];
  /** One entry per output directory. */
  directories: OutputDirectoryResult[];
  /** Non-fatal problems: permission errors, unsupported regions, failed services. */
  warnings: string[];
}

export interface OutputDirectoryResult {
  path: string;
  resourceCount: number;
  /** `skipped` when config generation was disabled or Terraform is unavailable. */
  generation: 'succeeded' | 'failed' | 'skipped';
  message?: string;
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
