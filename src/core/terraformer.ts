import { BaseProvider } from './provider';
import { HclGenerator } from './hcl-generator';
import { ImportOptions, TerraformResource, Logger, ProgressCallback } from '../types';
import * as path from 'path';
import * as fs from 'fs/promises';

export class Terraformer {
  private provider: BaseProvider;
  private logger: Logger;
  private hclGenerator: HclGenerator;

  constructor(provider: BaseProvider, logger: Logger) {
    this.provider = provider;
    this.logger = logger;
    this.hclGenerator = new HclGenerator('hcl', true);
  }

  async import(options: ImportOptions, progressCallback?: ProgressCallback): Promise<void> {
    try {
      this.logger.info(`Starting import for provider: ${this.provider.getName()}`);
      
      // Initialize provider
      await this.provider.init([]);
      
      const allResources: TerraformResource[] = [];
      const supportedServices = this.provider.getSupportedServices();
      
      // Filter services based on options
      const servicesToImport = this.filterServices(options.resources, Object.keys(supportedServices), options.excludes);
      
      this.logger.info(`Importing services: ${servicesToImport.join(', ')}`);
      
      // Import each service
      for (let i = 0; i < servicesToImport.length; i++) {
        const serviceName = servicesToImport[i];
        
        if (progressCallback) {
          progressCallback(`Importing ${serviceName}...`, i + 1, servicesToImport.length);
        }
        
        try {
          const service = await this.provider.initService(serviceName, options.verbose || false);
          await service.initResources();
          
          // Apply filters
          if (options.filters && options.filters.length > 0) {
            this.applyFilters(service, options.filters);
          }
          
          // Run post-conversion hook
          await service.postConvertHook();
          
          const serviceResources = service.getResources();
          allResources.push(...serviceResources);
          
          this.logger.info(`Imported ${serviceResources.length} resources from ${serviceName}`);
        } catch (error) {
          this.logger.error(`Error importing ${serviceName}: ${error}`);
          if (options.verbose) {
            throw error;
          }
        }
      }
      
      // Generate output files
      await this.generateOutput(allResources, options);
      
      this.logger.info(`Import completed. Total resources: ${allResources.length}`);
      
    } catch (error) {
      this.logger.error(`Import failed: ${error}`);
      throw error;
    }
  }

  async plan(options: ImportOptions): Promise<ImportOptions> {
    this.logger.info(`Generating plan for provider: ${this.provider.getName()}`);
    
    // This would generate a plan file that can be reviewed before import
    const planData = {
      version: '1.0.0',
      provider: this.provider.getName(),
      options,
      args: [],
      importedResources: {}
    };
    
    const outputPath = options.pathOutput || 'generated';
    const planPath = path.join(outputPath, this.provider.getName(), 'plan.json');
    
    await fs.mkdir(path.dirname(planPath), { recursive: true });
    await fs.writeFile(planPath, JSON.stringify(planData, null, 2));
    
    this.logger.info(`Plan saved to: ${planPath}`);
    return options;
  }

  private filterServices(
    requestedResources: string[], 
    availableServices: string[], 
    excludes?: string[]
  ): string[] {
    let services = availableServices;
    
    // If specific resources are requested
    if (requestedResources.length > 0 && !requestedResources.includes('*')) {
      services = availableServices.filter(service => 
        requestedResources.includes(service)
      );
    }
    
    // Apply excludes
    if (excludes && excludes.length > 0) {
      services = services.filter(service => 
        !excludes.includes(service)
      );
    }
    
    return services;
  }

  private applyFilters(service: any, filters: string[]): void {
    // This would apply the filters to the service resources
    // Implementation depends on the specific filter logic
    for (const filter of filters) {
      const parsedFilters = service.parseFilter(filter);
      // Apply filters to resources
    }
  }

  private async generateOutput(resources: TerraformResource[], options: ImportOptions): Promise<void> {
    const outputPath = options.pathOutput || 'generated';
    const pathPattern = options.pathPattern || '{output}/{provider}/{service}/';
    const isCompact = options.compact || false;
    const outputFormat = options.output || 'hcl';
    
    // Generate provider data
    const providerData = this.provider.getProviderData();
    
    // Group resources by service
    const resourcesByService = this.groupResourcesByService(resources);
    
    // Generate files for each service
    for (const [serviceName, serviceResources] of Object.entries(resourcesByService)) {
      const serviceOutputPath = this.resolvePathPattern(pathPattern, {
        output: outputPath,
        provider: this.provider.getName(),
        service: serviceName
      });
      
      // Generate HCL/JSON files
      const hclGenerator = new HclGenerator(outputFormat as 'hcl' | 'json', !options.noSort);
      await hclGenerator.generateFiles(
        serviceResources,
        providerData,
        serviceOutputPath,
        serviceName,
        isCompact
      );
      
      // Generate Terraform state
      await hclGenerator.generateTerraformState(serviceResources, serviceOutputPath);
      
      this.logger.info(`Generated files for ${serviceName} in ${serviceOutputPath}`);
    }
  }

  private groupResourcesByService(resources: TerraformResource[]): Record<string, TerraformResource[]> {
    const grouped: Record<string, TerraformResource[]> = {};
    
    for (const resource of resources) {
      const serviceName = resource.type.replace(`${resource.provider}_`, '');
      if (!grouped[serviceName]) {
        grouped[serviceName] = [];
      }
      grouped[serviceName].push(resource);
    }
    
    return grouped;
  }

  private resolvePathPattern(pattern: string, variables: Record<string, string>): string {
    let resolved = pattern;
    for (const [key, value] of Object.entries(variables)) {
      resolved = resolved.replace(`{${key}}`, value);
    }
    return resolved;
  }

  getSupportedServices(): string[] {
    return Object.keys(this.provider.getSupportedServices());
  }

  getResourceConnections(): Record<string, Record<string, string[]>> {
    return this.provider.getResourceConnections();
  }
}


