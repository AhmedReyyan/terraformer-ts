import {
  Route53Client,
  paginateListHostedZones,
  paginateListHealthChecks,
  paginateListQueryLoggingConfigs,
  ListResourceRecordSetsCommand,
  ListResourceRecordSetsCommandInput,
  ListReusableDelegationSetsCommand,
  HostedZone,
  RRType
} from '@aws-sdk/client-route-53';
import { mapLimit } from '../../../core/provider';
import { AwsService } from '../aws-service';

const RECORD_TYPES = new Set<string>(Object.values(RRType));

/** Strip the `/hostedzone/` or `/delegationset/` prefix the API puts on IDs. */
export function cleanId(id: string): string {
  return id.replace(/^\/[a-z]+\//, '');
}

/**
 * Decode a DNS name as returned by Route 53: octal escapes (`\052` is `*`) are
 * replaced by their character and the trailing dot is removed.
 */
export function decodeRecordName(name: string): string {
  return name
    .replace(/\\([0-7]{3})/g, (_match, octal: string) => String.fromCharCode(parseInt(octal, 8)))
    .replace(/\.$/, '');
}

export class Route53Service extends AwsService {
  static readonly global = true;

  private route53!: Route53Client;

  async initResources(): Promise<void> {
    this.route53 = this.client(Route53Client);
    const zones: HostedZone[] = [];

    await this.collect('Route53 hosted zones', async () => {
      for await (const page of paginateListHostedZones({ client: this.route53 }, {})) {
        for (const zone of page.HostedZones || []) {
          // Zones created and managed by another service (e.g. Cloud Map namespaces) are skipped.
          if (zone.LinkedService) {
            continue;
          }
          zones.push(zone);
          const id = cleanId(zone.Id!);
          const name = decodeRecordName(zone.Name!);
          // VPC associations of private zones are imported as the zone's inline `vpc` blocks, so
          // aws_route53_zone_association is not imported (both together cause a perpetual diff).
          this.add('aws_route53_zone', id, name, {
            name,
            zone_id: id,
            private_zone: zone.Config?.PrivateZone ?? false
          });
        }
      }
    });

    await mapLimit(zones, 5, zone =>
      this.collect(`Route53 records of ${decodeRecordName(zone.Name!)}`, () => this.loadRecords(zone))
    );

    await this.collect('Route53 health checks', async () => {
      for await (const page of paginateListHealthChecks({ client: this.route53 }, {})) {
        for (const check of page.HealthChecks || []) {
          // Health checks created by another service (e.g. Cloud Map) are managed by that service.
          if (check.LinkedService) {
            continue;
          }
          const config = check.HealthCheckConfig;
          const label = config?.FullyQualifiedDomainName || config?.IPAddress || check.Id!;
          this.add('aws_route53_health_check', check.Id!, `${config?.Type || 'health_check'}_${label}`, {
            id: check.Id,
            type: config?.Type,
            fqdn: config?.FullyQualifiedDomainName
          });
        }
      }
    });

    await this.collect('Route53 reusable delegation sets', async () => {
      let Marker: string | undefined;
      do {
        const page = await this.route53.send(new ListReusableDelegationSetsCommand({ Marker }));
        for (const set of page.DelegationSets || []) {
          const id = cleanId(set.Id!);
          this.add('aws_route53_delegation_set', id, set.CallerReference || id, { id, reference_name: set.CallerReference });
        }
        Marker = page.IsTruncated ? page.NextMarker : undefined;
      } while (Marker);
    });

    await this.collect('Route53 query logging configs', async () => {
      for await (const page of paginateListQueryLoggingConfigs({ client: this.route53 }, {})) {
        for (const config of page.QueryLoggingConfigs || []) {
          this.add('aws_route53_query_log', config.Id!, `${config.HostedZoneId}_query_log`, {
            id: config.Id,
            zone_id: config.HostedZoneId,
            cloudwatch_log_group_arn: config.CloudWatchLogsLogGroupArn
          });
        }
      }
    });
  }

  private async loadRecords(zone: HostedZone): Promise<void> {
    const zoneId = cleanId(zone.Id!);
    const zoneName = decodeRecordName(zone.Name!);
    const input: ListResourceRecordSetsCommandInput = { HostedZoneId: zoneId };

    while (true) {
      const page = await this.route53.send(new ListResourceRecordSetsCommand(input));
      for (const record of page.ResourceRecordSets || []) {
        const name = decodeRecordName(record.Name!);
        const type = record.Type!;
        // The apex NS and SOA records are created by Route 53 with the zone and belong to it.
        if ((type === 'NS' || type === 'SOA') && name === zoneName) {
          continue;
        }
        const setIdentifier = record.SetIdentifier;
        // The provider splits the import ID on `_`: a set identifier containing `_` or equal to a
        // record type cannot be parsed back, so such records cannot be imported.
        if (setIdentifier && (setIdentifier.includes('_') || RECORD_TYPES.has(setIdentifier))) {
          this.warn(`record ${name} ${type} in zone ${zoneId}: set identifier "${setIdentifier}" cannot be expressed in an import ID; skipped`);
          continue;
        }
        const importId = `${zoneId}_${name}_${type}${setIdentifier ? `_${setIdentifier}` : ''}`;
        this.add('aws_route53_record', importId, `${name}_${type}${setIdentifier ? `_${setIdentifier}` : ''}`, {
          zone_id: zoneId,
          name,
          type,
          set_identifier: setIdentifier
        });
      }
      if (!page.IsTruncated) {
        break;
      }
      input.StartRecordName = page.NextRecordName;
      input.StartRecordType = page.NextRecordType;
      input.StartRecordIdentifier = page.NextRecordIdentifier;
    }
  }
}
