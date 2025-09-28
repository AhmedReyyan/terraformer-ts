import { TerraformResource, ProviderData, HclOutput, ImportOptions } from '../types';
import * as fs from 'fs/promises';
import * as path from 'path';

export class HclGenerator {
  private output: 'hcl' | 'json';
  private sort: boolean;

  constructor(output: 'hcl' | 'json' = 'hcl', sort: boolean = true) {
    this.output = output;
    this.sort = sort;
  }

  async generateFiles(
    resources: TerraformResource[],
    providerData: ProviderData,
    outputPath: string,
    serviceName: string,
    isCompact: boolean = false
  ): Promise<void> {
    await this.ensureDirectory(outputPath);

    // Generate provider configuration
    await this.generateProviderFile(providerData, outputPath);

    // Generate resource files
    if (isCompact) {
      await this.generateCompactResourceFile(resources, outputPath, serviceName);
    } else {
      await this.generateSeparateResourceFiles(resources, outputPath, serviceName);
    }
  }

  private async ensureDirectory(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }

  private async generateProviderFile(providerData: ProviderData, outputPath: string): Promise<void> {
    const fileName = `provider.${this.output === 'hcl' ? 'tf' : 'json'}`;
    const filePath = path.join(outputPath, fileName);
    
    const content = this.output === 'hcl' 
      ? this.generateHclProvider(providerData)
      : JSON.stringify(providerData, null, 2);

    await fs.writeFile(filePath, content, 'utf8');
  }

  private async generateCompactResourceFile(
    resources: TerraformResource[], 
    outputPath: string, 
    serviceName: string
  ): Promise<void> {
    const fileName = `resources.${this.output === 'hcl' ? 'tf' : 'json'}`;
    const filePath = path.join(outputPath, fileName);
    
    const content = this.output === 'hcl'
      ? this.generateHclResources(resources)
      : JSON.stringify({ resources: this.groupResourcesByType(resources) }, null, 2);

    await fs.writeFile(filePath, content, 'utf8');
  }

  private async generateSeparateResourceFiles(
    resources: TerraformResource[], 
    outputPath: string, 
    serviceName: string
  ): Promise<void> {
    const groupedResources = this.groupResourcesByType(resources);
    
    for (const [resourceType, resourceList] of Object.entries(groupedResources)) {
      const fileName = `${resourceType}.${this.output === 'hcl' ? 'tf' : 'json'}`;
      const filePath = path.join(outputPath, fileName);
      
      const content = this.output === 'hcl'
        ? this.generateHclResources(resourceList)
        : JSON.stringify({ resources: { [resourceType]: resourceList } }, null, 2);

      await fs.writeFile(filePath, content, 'utf8');
    }
  }

  private generateHclProvider(providerData: ProviderData): string {
    let hcl = '';
    
    // Terraform block
    if (providerData.terraform) {
      hcl += 'terraform {\n';
      if (providerData.terraform.required_providers) {
        hcl += '  required_providers {\n';
        for (const provider of providerData.terraform.required_providers) {
          for (const [name, config] of Object.entries(provider)) {
            hcl += `    ${name} = {\n`;
            if (config.source) hcl += `      source = "${config.source}"\n`;
            if (config.version) hcl += `      version = "${config.version}"\n`;
            hcl += '    }\n';
          }
        }
        hcl += '  }\n';
      }
      hcl += '}\n\n';
    }

    // Provider blocks
    for (const [providerName, config] of Object.entries(providerData.provider)) {
      hcl += `provider "${providerName}" {\n`;
      for (const [key, value] of Object.entries(config)) {
        hcl += `  ${key} = ${this.formatHclValue(value)}\n`;
      }
      hcl += '}\n\n';
    }

    return hcl;
  }

  private generateHclResources(resources: TerraformResource[]): string {
    let hcl = '';
    const grouped = this.groupResourcesByType(resources);

    for (const [resourceType, resourceList] of Object.entries(grouped)) {
      for (const resource of resourceList) {
        hcl += `resource "${resource.type}" "${resource.name}" {\n`;
        
        // Add attributes
        const allAttributes = { ...resource.attributes, ...resource.additionalFields };
        for (const [key, value] of Object.entries(allAttributes)) {
          if (this.shouldIncludeAttribute(key, value, resource)) {
            hcl += `  ${key} = ${this.formatHclValue(value)}\n`;
          }
        }
        
        hcl += '}\n\n';
      }
    }

    return hcl;
  }

  private groupResourcesByType(resources: TerraformResource[]): Record<string, TerraformResource[]> {
    const grouped: Record<string, TerraformResource[]> = {};
    
    for (const resource of resources) {
      const type = resource.type.replace(`${resource.provider}_`, '');
      if (!grouped[type]) {
        grouped[type] = [];
      }
      grouped[type].push(resource);
    }

    return grouped;
  }

  private shouldIncludeAttribute(key: string, value: any, resource: TerraformResource): boolean {
    // Skip ignored keys
    if (resource.ignoreKeys?.some(pattern => new RegExp(pattern).test(key))) {
      return false;
    }

    // Skip empty values unless allowed
    if (value === null || value === undefined || value === '') {
      if (resource.allowEmptyValues?.some(pattern => new RegExp(pattern).test(key))) {
        return true;
      }
      return false;
    }

    return true;
  }

  private formatHclValue(value: any): string {
    if (value === null || value === undefined) {
      return 'null';
    }
    
    if (typeof value === 'string') {
      // Escape quotes and handle multiline strings
      const escaped = value.replace(/"/g, '\\"').replace(/\n/g, '\\n');
      return `"${escaped}"`;
    }
    
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    
    if (Array.isArray(value)) {
      const items = value.map(item => this.formatHclValue(item));
      return `[${items.join(', ')}]`;
    }
    
    if (typeof value === 'object') {
      const entries = Object.entries(value).map(([k, v]) => `${k} = ${this.formatHclValue(v)}`);
      return `{\n    ${entries.join(',\n    ')}\n  }`;
    }
    
    return `"${String(value)}"`;
  }

  async generateTerraformState(
    resources: TerraformResource[],
    outputPath: string
  ): Promise<void> {
    const state = {
      version: 4,
      terraform_version: '1.0.0',
      serial: 1,
      lineage: this.generateLineage(),
      outputs: {},
      resources: resources.map(resource => ({
        mode: 'managed',
        type: resource.type,
        name: resource.name,
        provider: `provider["registry.terraform.io/hashicorp/${resource.provider}"]`,
        instances: [{
          schema_version: 0,
          attributes: resource.attributes,
          sensitive_attributes: [],
          private: this.generatePrivateKey(),
          dependencies: resource.dependencies || []
        }]
      }))
    };

    const statePath = path.join(outputPath, 'terraform.tfstate');
    await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
  }

  private generateLineage(): string {
    // Generate a unique lineage identifier
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  private generatePrivateKey(): string {
    // Generate a base64 encoded private key
    return Buffer.from(Math.random().toString(36)).toString('base64');
  }
}


