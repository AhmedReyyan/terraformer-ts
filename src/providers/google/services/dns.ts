import { AssetRule, GoogleAsset, GoogleService } from '../google-service';

/**
 * Cloud DNS managed zones. Assets are named by zone number
 * (`projects/<p>/managedZones/<number>`) while the import ID needs the zone name,
 * which the search returns as the display name. Record sets are not imported:
 * their asset names use the zone number and an undocumented record key.
 */
export class DnsService extends GoogleService {
  protected readonly rules: AssetRule[] = [
    {
      assetType: 'dns.googleapis.com/ManagedZone', path: 'projects/*/managedZones/*', type: 'google_dns_managed_zone',
      id: (m, asset) => {
        const zone = zoneName(m[2], asset);
        if (!zone) {
          this.warn(`DNS managed zone ${asset.name} skipped: its zone name is not known`);
          return undefined;
        }
        return `projects/${m[1]}/managedZones/${zone}`;
      },
      name: (m, asset) => zoneName(m[2], asset) || m[2]
    }
  ];
}

const ZONE_NAME = /^[a-z][a-z0-9-]{0,62}$/;

function zoneName(segment: string, asset: GoogleAsset): string | undefined {
  if (ZONE_NAME.test(segment)) {
    return segment;
  }
  return ZONE_NAME.test(asset.displayName) ? asset.displayName : undefined;
}
