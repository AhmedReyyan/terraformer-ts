import { ResourceFilter, TerraformResource } from '../types';

/**
 * Parse a filter expression. Two forms are supported (compatible with Go terraformer):
 *
 *   <type>=<id1>:<id2>                      keep only these IDs of the given type
 *   Type=<type>;Name=<field>;Value=<v1>:<v2>  keep resources whose field matches a value
 *
 * `<type>` may be a service name (`s3`), a full resource type (`aws_s3_bucket`) or a
 * type without the provider prefix (`s3_bucket`). `Type=` may be omitted to apply the
 * filter to every resource. `Value=` may be omitted to keep resources where the field is set.
 * `<field>` is `id`, `name` or a dotted attribute path such as `tags.Environment`.
 */
export function parseFilter(rawFilter: string): ResourceFilter[] {
  const filter = rawFilter.trim();
  if (filter === '') {
    return [];
  }

  if (!filter.includes(';') && !filter.startsWith('Type=') && !filter.startsWith('Name=') && filter.includes('=')) {
    const separator = filter.indexOf('=');
    const serviceName = filter.substring(0, separator);
    return [{
      serviceName,
      fieldPath: 'id',
      acceptableValues: splitValues(filter.substring(separator + 1)),
      isApplicable: (resourceName: string) => matchesType(serviceName, resourceName)
    }];
  }

  let serviceName = '';
  let fieldPath = '';
  let acceptableValues: string[] | undefined;

  for (const part of filter.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) {
      throw new Error(`Invalid filter "${rawFilter}": expected Key=Value parts separated by ";"`);
    }
    const key = part.substring(0, separator).trim();
    const value = part.substring(separator + 1);
    switch (key) {
      case 'Type':
        serviceName = value;
        break;
      case 'Name':
        fieldPath = value;
        break;
      case 'Value':
        acceptableValues = splitValues(value);
        break;
      default:
        throw new Error(`Invalid filter "${rawFilter}": unknown key "${key}" (expected Type, Name or Value)`);
    }
  }

  if (fieldPath === '') {
    throw new Error(`Invalid filter "${rawFilter}": Name=<field> is required`);
  }

  return [{
    serviceName,
    fieldPath,
    acceptableValues,
    isApplicable: (resourceName: string) => matchesType(serviceName, resourceName)
  }];
}

/** Keep only resources that satisfy every filter applicable to them. */
export function applyFilters(resources: TerraformResource[], filters: ResourceFilter[]): TerraformResource[] {
  if (filters.length === 0) {
    return resources;
  }
  return resources.filter(resource =>
    filters.every(filter => {
      const applicable = filter.isApplicable(resource.type) ||
        (resource.service !== undefined && filter.isApplicable(resource.service)) ||
        filter.isApplicable(resource.type.replace(`${resource.provider}_`, ''));
      if (!applicable) {
        return true;
      }
      const value = getField(resource, filter.fieldPath);
      if (filter.acceptableValues === undefined || filter.acceptableValues.length === 0) {
        return value !== undefined && value !== null && value !== '';
      }
      const values = Array.isArray(value) ? value.map(String) : [String(value)];
      return value !== undefined && value !== null && values.some(v => filter.acceptableValues!.includes(v));
    })
  );
}

function matchesType(filterType: string, resourceName: string): boolean {
  return filterType === '' || filterType === resourceName;
}

/** Values are separated by ":". Lists of ARNs (which contain ":") are split on ":arn:". */
function splitValues(raw: string): string[] {
  if (raw.startsWith('arn:')) {
    return raw.split(/:(?=arn:)/);
  }
  return raw.split(':');
}

function getField(resource: TerraformResource, fieldPath: string): any {
  if (fieldPath === 'id') {
    return resource.id;
  }
  if (fieldPath === 'name' && resource.attributes.name === undefined) {
    return resource.name;
  }
  if (fieldPath.startsWith('tags.')) {
    // Tag keys often contain dots themselves (kubernetes.io/cluster/x).
    return resource.attributes.tags?.[fieldPath.substring(5)];
  }
  let current: any = resource.attributes;
  for (const segment of fieldPath.split('.')) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}
