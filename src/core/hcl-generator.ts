import { TerraformResource, ProviderData } from '../types';
import * as fs from 'fs/promises';
import * as path from 'path';

export const PROVIDER_FILE = 'provider';
export const IMPORTS_FILE = 'imports';
export const GENERATED_FILE = 'generated.tf';
export const INVENTORY_FILE = 'inventory.json';

/**
 * Writes a Terraform root module for a set of discovered resources:
 *
 *   provider.tf   - terraform/required_providers and provider configuration
 *   imports.tf    - one `import` block per resource
 *   inventory.json - what was discovered, with the metadata used for filtering
 *
 * The resource blocks themselves are produced by Terraform
 * (`terraform plan -generate-config-out=generated.tf`), which reads every
 * attribute through the real provider so the configuration matches the provider schema.
 */
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
    outputPath: string
  ): Promise<void> {
    await fs.mkdir(outputPath, { recursive: true });

    const ordered = this.sort ? sortResources(resources) : resources;
    const ext = this.output === 'hcl' ? 'tf' : 'tf.json';

    // Remove files written in the other format so Terraform does not see duplicates.
    const otherExt = this.output === 'hcl' ? 'tf.json' : 'tf';
    await removeIfExists(path.join(outputPath, `${PROVIDER_FILE}.${otherExt}`));
    await removeIfExists(path.join(outputPath, `${IMPORTS_FILE}.${otherExt}`));

    await fs.writeFile(
      path.join(outputPath, `${PROVIDER_FILE}.${ext}`),
      this.output === 'hcl' ? renderProviderHcl(providerData) : renderProviderJson(providerData),
      'utf8'
    );
    await fs.writeFile(
      path.join(outputPath, `${IMPORTS_FILE}.${ext}`),
      this.output === 'hcl' ? renderImportsHcl(ordered) : renderImportsJson(ordered),
      'utf8'
    );
    await fs.writeFile(
      path.join(outputPath, INVENTORY_FILE),
      JSON.stringify(ordered.map(toInventoryEntry), null, 2) + '\n',
      'utf8'
    );
  }
}

export function sortResources(resources: TerraformResource[]): TerraformResource[] {
  return [...resources].sort((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name) : a.type.localeCompare(b.type)
  );
}

export function renderImportsHcl(resources: TerraformResource[]): string {
  let hcl = '';
  for (const resource of resources) {
    hcl += 'import {\n';
    hcl += `  to = ${resource.type}.${resource.name}\n`;
    hcl += `  id = ${hclString(resource.id)}\n`;
    hcl += '}\n\n';
  }
  return hcl;
}

export function renderImportsJson(resources: TerraformResource[]): string {
  return JSON.stringify({
    import: resources.map(resource => ({
      to: `${resource.type}.${resource.name}`,
      id: escapeTemplate(resource.id)
    }))
  }, null, 2) + '\n';
}

export function renderProviderHcl(providerData: ProviderData): string {
  let hcl = '';

  if (providerData.terraform?.required_providers) {
    hcl += 'terraform {\n';
    hcl += '  required_version = ">= 1.5.0"\n\n';
    hcl += '  required_providers {\n';
    for (const provider of providerData.terraform.required_providers) {
      for (const [name, config] of Object.entries(provider)) {
        hcl += `    ${name} = {\n`;
        if (config.source) hcl += `      source  = ${hclString(config.source)}\n`;
        if (config.version) hcl += `      version = ${hclString(config.version)}\n`;
        hcl += '    }\n';
      }
    }
    hcl += '  }\n';
    hcl += '}\n\n';
  }

  for (const [providerName, config] of Object.entries(providerData.provider)) {
    hcl += `provider "${providerName}" {\n`;
    hcl += renderBody(config || {}, 1);
    hcl += '}\n\n';
  }

  return hcl;
}

export function renderProviderJson(providerData: ProviderData): string {
  const json: Record<string, any> = {};
  if (providerData.terraform?.required_providers) {
    const requiredProviders: Record<string, any> = {};
    for (const provider of providerData.terraform.required_providers) {
      Object.assign(requiredProviders, provider);
    }
    json.terraform = {
      required_version: '>= 1.5.0',
      required_providers: requiredProviders
    };
  }
  json.provider = providerData.provider;
  return JSON.stringify(json, null, 2) + '\n';
}

/**
 * Render the body of a block. Nested plain objects become nested blocks and arrays of
 * objects become repeated blocks, which is how provider configuration is structured
 * (`features {}`, `assume_role {}`, `default_tags {}`).
 */
function renderBody(body: Record<string, any>, depth: number): string {
  const indent = '  '.repeat(depth);
  let hcl = '';
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (isPlainObject(value) && Object.keys(value).length === 0) {
      hcl += `${indent}${key} {}\n`;
    } else if (isPlainObject(value)) {
      hcl += `${indent}${key} {\n${renderBody(value, depth + 1)}${indent}}\n`;
    } else if (Array.isArray(value) && value.length > 0 && value.every(isPlainObject)) {
      for (const item of value) {
        hcl += `${indent}${key} {\n${renderBody(item, depth + 1)}${indent}}\n`;
      }
    } else {
      hcl += `${indent}${key} = ${hclValue(value)}\n`;
    }
  }
  return hcl;
}

export function hclValue(value: any): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'string') {
    return hclString(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(hclValue).join(', ')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).map(([k, v]) => `${hclString(k)} = ${hclValue(v)}`);
    return `{ ${entries.join(', ')} }`;
  }
  return hclString(String(value));
}

/** Quote a string as an HCL string literal, escaping template sequences. */
export function hclString(value: string): string {
  let escaped = '';
  for (const char of escapeTemplate(value)) {
    switch (char) {
      case '\\': escaped += '\\\\'; break;
      case '"': escaped += '\\"'; break;
      case '\n': escaped += '\\n'; break;
      case '\r': escaped += '\\r'; break;
      case '\t': escaped += '\\t'; break;
      default: {
        const code = char.codePointAt(0)!;
        escaped += code < 0x20 || code === 0x7f
          ? `\\u${code.toString(16).padStart(4, '0')}`
          : char;
      }
    }
  }
  return `"${escaped}"`;
}

/** `${` and `%{` start template sequences in both HCL and JSON syntax strings. */
function escapeTemplate(value: string): string {
  // Replacement functions, because "$$" in a replacement string means a literal "$".
  return value.replace(/\$\{/g, () => '$${').replace(/%\{/g, () => '%%{');
}

function toInventoryEntry(resource: TerraformResource): Record<string, any> {
  return {
    address: `${resource.type}.${resource.name}`,
    type: resource.type,
    name: resource.name,
    id: resource.id,
    service: resource.service,
    region: resource.region,
    attributes: resource.attributes
  };
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function removeIfExists(filePath: string): Promise<void> {
  await fs.rm(filePath, { force: true });
}
