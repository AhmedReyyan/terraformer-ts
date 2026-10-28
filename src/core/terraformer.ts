import { BaseProvider, describeError } from './provider';
import { HclGenerator } from './hcl-generator';
import { applyFilters, parseFilter } from './filter';
import { NameAllocator } from './naming';
import { TerraformCli } from './terraform-cli';
import {
  ImportOptions,
  ImportResult,
  OutputDirectoryResult,
  ProviderData,
  ResourceFilter,
  TerraformResource,
  Logger,
  ProgressCallback
} from '../types';
import * as path from 'path';
import * as fs from 'fs/promises';

const DEFAULT_PATH_PATTERN = '{output}/{provider}/{service}/';
const COMPACT_PATH_PATTERN = '{output}/{provider}/';

interface DiscoveryResult {
  resources: TerraformResource[];
  warnings: string[];
  /** Provider configuration for each scope (region / project / subscription). */
  providerData: Map<string, ProviderData>;
}

export class Terraformer {
  private provider: BaseProvider;
  private logger: Logger;

  constructor(provider: BaseProvider, logger: Logger) {
    this.provider = provider;
    this.logger = logger;
  }

  /**
   * Discover resources, write provider + import blocks for each output directory and,
   * when Terraform is available, generate the resource configuration with
   * `terraform plan -generate-config-out`.
   */
  async import(options: ImportOptions, progressCallback?: ProgressCallback): Promise<ImportResult> {
    this.logger.info(`Starting import for provider: ${this.provider.getName()}`);

    const discovery = await this.discover(options, progressCallback);
    const warnings = [...discovery.warnings];
    const directories = await this.writeDirectories(discovery, options);

    if (directories.length > 0 && options.generate !== false) {
      await this.generateConfiguration(directories, options, warnings, progressCallback);
    }

    this.logger.info(`Import completed. Total resources: ${discovery.resources.length}`);
    return { resources: discovery.resources, directories: directories.map(d => d.result), warnings };
  }

  /** Discover resources and write them to plan.json without generating any Terraform files. */
  async plan(options: ImportOptions, progressCallback?: ProgressCallback): Promise<ImportResult> {
    this.logger.info(`Generating plan for provider: ${this.provider.getName()}`);
    const discovery = await this.discover(options, progressCallback);

    const outputPath = options.pathOutput || 'generated';
    const planPath = path.join(outputPath, this.provider.getName(), 'plan.json');
    const planData = {
      version: '2.0.0',
      provider: this.provider.getName(),
      options,
      importedResources: groupBy(discovery.resources, r => r.service || 'unknown'),
      warnings: discovery.warnings
    };

    await fs.mkdir(path.dirname(planPath), { recursive: true });
    await fs.writeFile(planPath, JSON.stringify(planData, null, 2), 'utf8');

    this.logger.info(`Plan saved to: ${planPath}`);
    return { resources: discovery.resources, directories: [], warnings: discovery.warnings };
  }

  async discover(options: ImportOptions, progressCallback?: ProgressCallback): Promise<DiscoveryResult> {
    const warnings: string[] = [];
    const resources: TerraformResource[] = [];
    const providerData = new Map<string, ProviderData>();

    const services = this.selectServices(options.resources, options.excludes, warnings);
    const filters = this.parseFilters(options.filters);
    const scopes = this.getScopes(options);

    this.logger.info(`Importing services: ${services.join(', ') || '(none)'}`);

    const total = scopes.length * services.length;
    let step = 0;

    for (const [scopeIndex, scope] of scopes.entries()) {
      await this.provider.init(scope === undefined ? [] : [scope]);
      const scopeName = this.provider.getScope();
      providerData.set(scopeName, this.provider.getProviderData());

      for (const serviceName of services) {
        step++;
        if (scopeIndex > 0 && this.provider.isGlobalService(serviceName)) {
          continue;
        }
        progressCallback?.(`Importing ${serviceName} (${scopeName})...`, step, total);

        try {
          const service = await this.provider.initService(serviceName, options.verbose || false);
          await service.initResources();
          await service.postConvertHook();

          const found = service.getResources().map(resource => ({
            ...resource,
            service: resource.service || serviceName,
            region: scopeName
          }));
          const kept = applyFilters(found, filters);
          resources.push(...kept);
          warnings.push(...service.getWarnings());

          const filtered = found.length - kept.length;
          this.logger.info(
            `Found ${kept.length} resources in ${serviceName} (${scopeName})` +
            (filtered > 0 ? `, ${filtered} excluded by filters` : '')
          );
        } catch (error) {
          const message = `[${this.provider.getName()}:${serviceName}] failed in ${scopeName}: ${describeError(error)}`;
          warnings.push(message);
          this.logger.error(message);
        }
      }
    }

    return { resources, warnings, providerData };
  }

  private async writeDirectories(
    discovery: DiscoveryResult,
    options: ImportOptions
  ): Promise<Array<{ resources: TerraformResource[]; result: OutputDirectoryResult }>> {
    const pathPattern = this.getPathPattern(options);
    const generator = new HclGenerator(options.output || 'hcl', !options.noSort);

    const byDirectory = new Map<string, { scope: string; resources: TerraformResource[] }>();
    for (const resource of discovery.resources) {
      const directory = path.normalize(resolvePathPattern(pathPattern, {
        output: options.pathOutput || 'generated',
        provider: this.provider.getName(),
        service: resource.service || 'resources',
        region: resource.region || this.provider.getScope()
      }));
      if (!byDirectory.has(directory)) {
        byDirectory.set(directory, { scope: resource.region || this.provider.getScope(), resources: [] });
      }
      byDirectory.get(directory)!.resources.push(resource);
    }

    const written: Array<{ resources: TerraformResource[]; result: OutputDirectoryResult }> = [];
    for (const [directory, group] of byDirectory) {
      const resources = assignUniqueNames(dedupe(group.resources));
      const providerData = discovery.providerData.get(group.scope) || this.provider.getProviderData();
      await generator.generateFiles(resources, providerData, directory);
      this.logger.info(`Wrote ${resources.length} import blocks to ${directory}`);
      written.push({
        resources,
        result: { path: directory, resourceCount: resources.length, generation: 'skipped' }
      });
    }
    return written;
  }

  private async generateConfiguration(
    directories: Array<{ result: OutputDirectoryResult }>,
    options: ImportOptions,
    warnings: string[],
    progressCallback?: ProgressCallback
  ): Promise<void> {
    const cli = new TerraformCli(options.terraformBin || 'terraform', this.provider.getTerraformEnv());
    const version = await cli.detectVersion();

    if (!version) {
      const message = 'Terraform >= 1.5 was not found, so only import blocks were written. ' +
        'Install Terraform (or pass --terraform-bin) and run ' +
        '"terraform init && terraform plan -generate-config-out=generated.tf" in each output directory.';
      if (options.generate === true) {
        warnings.push(message);
      }
      this.logger.warn(message);
      for (const directory of directories) {
        directory.result.message = 'terraform not available';
      }
      return;
    }

    this.logger.info(`Generating resource configuration with Terraform ${version}`);
    const pluginCache = path.resolve(options.pathOutput || 'generated', '.terraform-plugin-cache');

    // Sequential on purpose: the shared plugin cache is not safe for concurrent `terraform init`.
    for (const [index, directory] of directories.entries()) {
      progressCallback?.(`Generating configuration in ${directory.result.path}...`, index + 1, directories.length);
      try {
        const result = await cli.generateConfig(directory.result.path, pluginCache);
        directory.result.generation = result.success ? 'succeeded' : 'failed';
        directory.result.message = result.message;
        if (!result.success) {
          warnings.push(`${directory.result.path}: ${result.message}`);
          this.logger.warn(`${directory.result.path}: ${result.message}`);
        }
      } catch (error) {
        directory.result.generation = 'failed';
        directory.result.message = describeError(error);
        warnings.push(`${directory.result.path}: ${describeError(error)}`);
        this.logger.warn(`${directory.result.path}: ${describeError(error)}`);
      }
    }
  }

  private selectServices(requested: string[], excludes: string[] = [], warnings: string[]): string[] {
    const supported = this.provider.getSupportedServices();
    const available = Object.keys(supported);
    const wanted = requested.map(r => r.trim()).filter(Boolean);
    let services: string[];

    if (wanted.length === 0 || wanted.includes('*')) {
      // Several names can point at the same service (aliases); import each service once.
      const seen = new Set<unknown>();
      services = available.filter(name => {
        if (seen.has(supported[name])) {
          return false;
        }
        seen.add(supported[name]);
        return true;
      });
    } else {
      for (const name of wanted) {
        if (!available.includes(name)) {
          const message = `[${this.provider.getName()}] unknown service "${name}" (run "terraformer list ${this.provider.getName()}")`;
          warnings.push(message);
          this.logger.warn(message);
        }
      }
      services = [...new Set(wanted)].filter(name => available.includes(name));
    }

    const excluded = new Set(excludes.map(e => e.trim()));
    return services.filter(service => !excluded.has(service));
  }

  private parseFilters(rawFilters: string[] = []): ResourceFilter[] {
    return rawFilters.flatMap(filter => parseFilter(filter));
  }

  private getScopes(options: ImportOptions): Array<string | undefined> {
    const scopes = options.regions?.length ? options.regions
      : options.projects?.length ? options.projects
        : options.region ? [options.region] : [];
    const unique = [...new Set(scopes.map(s => s.trim()).filter(Boolean))];
    return unique.length > 0 ? unique : [undefined];
  }

  private getPathPattern(options: ImportOptions): string {
    let pattern = options.pathPattern || (options.compact ? COMPACT_PATH_PATTERN : DEFAULT_PATH_PATTERN);
    // Every directory needs a single provider configuration, so separate scopes.
    if (this.getScopes(options).length > 1 && !pattern.includes('{region}')) {
      pattern = pattern.includes('{provider}')
        ? pattern.replace('{provider}', '{provider}/{region}')
        : path.join(pattern, '{region}');
    }
    return pattern;
  }

  getSupportedServices(): string[] {
    return Object.keys(this.provider.getSupportedServices());
  }

  getResourceConnections(): Record<string, Record<string, string[]>> {
    return this.provider.getResourceConnections();
  }
}

function resolvePathPattern(pattern: string, variables: Record<string, string>): string {
  let resolved = pattern;
  for (const [key, value] of Object.entries(variables)) {
    resolved = resolved.split(`{${key}}`).join(value);
  }
  return resolved;
}

/** The same object can be found twice (e.g. through two service aliases). */
function dedupe(resources: TerraformResource[]): TerraformResource[] {
  const seen = new Set<string>();
  return resources.filter(resource => {
    const key = `${resource.type}\u0000${resource.id}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function assignUniqueNames(resources: TerraformResource[]): TerraformResource[] {
  const allocator = new NameAllocator();
  return resources.map(resource => ({ ...resource, name: allocator.allocate(resource.type, resource.name) }));
}

function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  const grouped: Record<string, T[]> = {};
  for (const item of items) {
    (grouped[key(item)] ||= []).push(item);
  }
  return grouped;
}
