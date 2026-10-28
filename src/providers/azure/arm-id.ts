/**
 * Azure Resource Manager ID helpers.
 *
 * The azurerm provider parses most import IDs case-sensitively, but ARM list APIs sometimes
 * return IDs whose static segments use a different casing than the provider expects
 * (`resourcegroups`, `microsoft.insights/actiongroups`, `Microsoft.Network/dnszones`, ...).
 * `normalizeArmId` rewrites every static segment to the casing of the documented import
 * example (given as the canonical ARM type, e.g. `Microsoft.Network/dnsZones`) and keeps
 * the user-chosen names (subscription, resource group, resource names) as returned.
 */

export interface ParsedArmId {
  subscriptionId: string;
  resourceGroup?: string;
  /** Resource provider namespace, e.g. `Microsoft.Network`. */
  namespace?: string;
  /** Resource type segments, e.g. `['virtualNetworks', 'subnets']`. */
  types: string[];
  /** Resource names, one per type segment. */
  names: string[];
}

export function parseArmId(id: string): ParsedArmId | undefined {
  const parts = id.split('/').filter(Boolean);
  if (parts.length < 2 || parts[0].toLowerCase() !== 'subscriptions') {
    return undefined;
  }
  const parsed: ParsedArmId = { subscriptionId: parts[1], types: [], names: [] };
  let i = 2;
  if (i < parts.length && parts[i].toLowerCase() === 'resourcegroups') {
    if (i + 1 >= parts.length) {
      return undefined;
    }
    parsed.resourceGroup = parts[i + 1];
    i += 2;
  }
  if (i < parts.length) {
    if (parts[i].toLowerCase() !== 'providers' || i + 1 >= parts.length) {
      return undefined;
    }
    parsed.namespace = parts[i + 1];
    const rest = parts.slice(i + 2);
    if (rest.length === 0 || rest.length % 2 !== 0) {
      return undefined;
    }
    for (let j = 0; j < rest.length; j += 2) {
      parsed.types.push(rest[j]);
      parsed.names.push(rest[j + 1]);
    }
  }
  return parsed;
}

/** The ARM type of an ID, e.g. `Microsoft.Network/virtualNetworks/subnets` (casing as in the ID). */
export function armTypeOf(id: string): string | undefined {
  const parsed = parseArmId(id);
  return parsed?.namespace ? [parsed.namespace, ...parsed.types].join('/') : undefined;
}

/** The resource group name of an ID (casing as in the ID). */
export function resourceGroupOf(id: string): string | undefined {
  return parseArmId(id)?.resourceGroup;
}

/**
 * Rewrite `id` to the canonical casing of `canonicalType` (`Namespace/type[/childType...]`,
 * spelled exactly as in the provider's import docs). Throws when the ID is not of that type,
 * so a wrong mapping can never produce a silently broken import block.
 */
export function normalizeArmId(id: string, canonicalType: string): string {
  const parsed = parseArmId(id);
  const [namespace, ...types] = canonicalType.split('/');
  if (
    !parsed || !parsed.resourceGroup || !parsed.namespace ||
    parsed.namespace.toLowerCase() !== namespace.toLowerCase() ||
    parsed.types.length !== types.length ||
    parsed.types.some((type, index) => type.toLowerCase() !== types[index].toLowerCase())
  ) {
    throw new Error(`"${id}" is not a ${canonicalType} resource ID`);
  }
  const segments = types.map((type, index) => `${type}/${parsed.names[index]}`).join('/');
  return `/subscriptions/${parsed.subscriptionId}/resourceGroups/${parsed.resourceGroup}/providers/${namespace}/${segments}`;
}

/** Canonical resource group ID (`/subscriptions/{id}/resourceGroups/{name}`). */
export function normalizeResourceGroupId(id: string): string {
  const parsed = parseArmId(id);
  if (!parsed || !parsed.resourceGroup || parsed.namespace) {
    throw new Error(`"${id}" is not a resource group ID`);
  }
  return `/subscriptions/${parsed.subscriptionId}/resourceGroups/${parsed.resourceGroup}`;
}

/** Case-insensitive ID comparison key (ARM IDs are case-insensitive). */
export function idKey(id: string | undefined): string {
  return (id || '').toLowerCase().replace(/\/+$/, '');
}
