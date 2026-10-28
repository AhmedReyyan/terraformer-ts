/**
 * Convert an arbitrary string into a valid Terraform identifier.
 * Identifiers may contain letters, digits, underscores and dashes and must
 * start with a letter or underscore.
 */
export function sanitizeResourceName(name: string): string {
  let sanitized = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '');

  if (sanitized === '') {
    sanitized = 'resource';
  }
  if (!/^[a-z_]/.test(sanitized)) {
    sanitized = `_${sanitized}`;
  }
  return sanitized;
}

/**
 * Hands out names that are unique per resource type, appending `_2`, `_3`, ...
 * when two resources would otherwise share an address.
 */
export class NameAllocator {
  private used = new Map<string, Set<string>>();

  allocate(type: string, name: string): string {
    let names = this.used.get(type);
    if (!names) {
      names = new Set();
      this.used.set(type, names);
    }

    const base = sanitizeResourceName(name);
    let candidate = base;
    for (let i = 2; names.has(candidate); i++) {
      candidate = `${base}_${i}`;
    }
    names.add(candidate);
    return candidate;
  }
}
