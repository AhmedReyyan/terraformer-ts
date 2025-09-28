import { BaseService } from '../../../core/provider';
import { TerraformResource, ResourceFilter, ProviderConfig, Logger } from '../../../types';
import { 
  Route53Client, 
  ListHostedZonesCommand, 
  ListResourceRecordSetsCommand,
  ListHealthChecksCommand
} from '@aws-sdk/client-route-53';

export class Route53Service extends BaseService {
  private client: Route53Client;

  constructor(providerName: string, serviceName: string, config: ProviderConfig, logger: Logger) {
    super(providerName, serviceName, config, logger);
    this.client = new Route53Client({
      region: config.region || 'us-east-1',
      credentials: config.credentials ? {
        accessKeyId: config.credentials.accessKeyId || '',
        secretAccessKey: config.credentials.secretAccessKey || '',
        sessionToken: config.credentials.sessionToken || undefined
      } : undefined
    });
  }

  async initResources(): Promise<void> {
    await this.loadHostedZones();
    await this.loadHealthChecks();
  }

  private async loadHostedZones(): Promise<void> {
    try {
      this.log('Loading Route53 hosted zones...', 'info');
      
      const command = new ListHostedZonesCommand({});
      const response = await this.client.send(command);
      
      let zoneCount = 0;
      for (const zone of response.HostedZones || []) {
        if (zone.Id && zone.Name) {
          const zoneId = this.cleanZoneId(zone.Id);
          const zoneName = zone.Name.endsWith('.') ? zone.Name.slice(0, -1) : zone.Name;
          
          const resource = this.createResource(
            zoneId,
            `${zoneId}_${zoneName}`,
            'route53_zone',
            {
              name: zone.Name,
              force_destroy: false
            },
            {
              zone_id: zoneId,
              name_servers: [],
              comment: zone.Config?.Comment,
              private_zone: zone.Config?.PrivateZone || false
            }
          );
          
          this.addResource(resource);
          zoneCount++;
          
          // Load records for this zone
          await this.loadResourceRecordSets(zoneId);
        }
      }
      
      this.log(`Loaded ${zoneCount} Route53 hosted zones`, 'info');
    } catch (error) {
      this.log(`Error loading Route53 hosted zones: ${error}`, 'error');
      throw error;
    }
  }

  private async loadResourceRecordSets(zoneId: string): Promise<void> {
    try {
      this.log(`Loading Route53 records for zone ${zoneId}...`, 'info');
      
      let nextRecordName: string | undefined;
      let nextRecordType: string | undefined;
      let nextRecordIdentifier: string | undefined;
      let recordCount = 0;
      let isTruncated = true;
      
      while (isTruncated) {
        const command = new ListResourceRecordSetsCommand({
          HostedZoneId: zoneId,
          StartRecordName: nextRecordName,
          StartRecordType: nextRecordType as any,
          StartRecordIdentifier: nextRecordIdentifier
        });
        
        const response = await this.client.send(command);
        
        for (const record of response.ResourceRecordSets || []) {
          if (record.Name && record.Type) {
            const recordName = this.wildcardUnescape(record.Name);
            const typeString = record.Type;
            const setIdentifier = record.SetIdentifier || '';
            
            const resource = this.createResource(
              `${zoneId}_${recordName}_${typeString}_${setIdentifier}`,
              `${zoneId}_${recordName}_${typeString}_${setIdentifier}`,
              'route53_record',
              {
                name: recordName.endsWith('.') ? recordName.slice(0, -1) : recordName,
                zone_id: zoneId,
                type: typeString,
                set_identifier: setIdentifier
              },
              {
                ttl: record.TTL,
                records: record.ResourceRecords?.map(rr => rr.Value) || [],
                alias: record.AliasTarget ? {
                  name: record.AliasTarget.DNSName,
                  zone_id: record.AliasTarget.HostedZoneId,
                  evaluate_target_health: record.AliasTarget.EvaluateTargetHealth
                } : undefined,
                health_check_id: record.HealthCheckId,
                failover: record.Failover,
                geolocation: record.GeoLocation ? {
                  continent: record.GeoLocation.ContinentCode,
                  country: record.GeoLocation.CountryCode,
                  subdivision: record.GeoLocation.SubdivisionCode
                } : undefined,
                latency_routing_policy: record.Region ? [{
                  region: record.Region
                }] : undefined,
                weighted_routing_policy: record.Weight ? [{
                  weight: record.Weight
                }] : undefined,
                multivalue_answer_routing_policy: record.MultiValueAnswer || false
              }
            );
            
            this.addResource(resource);
            recordCount++;
          }
        }
        
        nextRecordName = response.NextRecordName;
        nextRecordType = response.NextRecordType;
        nextRecordIdentifier = response.NextRecordIdentifier;
        isTruncated = response.IsTruncated || false;
      }
      
      this.log(`Loaded ${recordCount} Route53 records for zone ${zoneId}`, 'info');
    } catch (error) {
      this.log(`Error loading Route53 records for zone ${zoneId}: ${error}`, 'error');
      throw error;
    }
  }

  private async loadHealthChecks(): Promise<void> {
    try {
      this.log('Loading Route53 health checks...', 'info');
      
      const command = new ListHealthChecksCommand({});
      const response = await this.client.send(command);
      
      let healthCheckCount = 0;
      for (const healthCheck of response.HealthChecks || []) {
        if (healthCheck.Id) {
          const healthCheckStringType = healthCheck.HealthCheckConfig?.Type || 'UNKNOWN';
          
          const resource = this.createResource(
            healthCheck.Id,
            `${healthCheck.Id}_${healthCheckStringType}`,
            'route53_health_check',
            {},
            {
              type: healthCheckStringType,
              resource_path: healthCheck.HealthCheckConfig?.ResourcePath,
              fqdn: healthCheck.HealthCheckConfig?.FullyQualifiedDomainName,
              port: healthCheck.HealthCheckConfig?.Port,
              measure_latency: healthCheck.HealthCheckConfig?.MeasureLatency,
              request_interval: healthCheck.HealthCheckConfig?.RequestInterval,
              failure_threshold: healthCheck.HealthCheckConfig?.FailureThreshold,
              search_string: healthCheck.HealthCheckConfig?.SearchString,
              invert_healthcheck: healthCheck.HealthCheckConfig?.Inverted,
              disabled: healthCheck.HealthCheckConfig?.Disabled,
              enable_sni: healthCheck.HealthCheckConfig?.EnableSNI,
              insufficient_data_health_status: healthCheck.HealthCheckConfig?.InsufficientDataHealthStatus,
              regions: healthCheck.HealthCheckConfig?.Regions || [],
              child_health_threshold: healthCheck.HealthCheckConfig?.ChildHealthChecks?.length,
              child_healthchecks: healthCheck.HealthCheckConfig?.ChildHealthChecks || [],
              cloudwatch_alarm_name: undefined,
              cloudwatch_alarm_region: undefined,
              cloudwatch_alarm_comparison_operator: healthCheck.CloudWatchAlarmConfiguration?.ComparisonOperator,
              cloudwatch_alarm_evaluation_periods: healthCheck.CloudWatchAlarmConfiguration?.EvaluationPeriods,
              cloudwatch_alarm_metric_name: healthCheck.CloudWatchAlarmConfiguration?.MetricName,
              cloudwatch_alarm_namespace: healthCheck.CloudWatchAlarmConfiguration?.Namespace,
              cloudwatch_alarm_period: healthCheck.CloudWatchAlarmConfiguration?.Period,
              cloudwatch_alarm_statistic: healthCheck.CloudWatchAlarmConfiguration?.Statistic,
              cloudwatch_alarm_threshold: healthCheck.CloudWatchAlarmConfiguration?.Threshold,
              cloudwatch_alarm_dimensions: healthCheck.CloudWatchAlarmConfiguration?.Dimensions || []
            }
          );
          
          this.addResource(resource);
          healthCheckCount++;
        }
      }
      
      this.log(`Loaded ${healthCheckCount} Route53 health checks`, 'info');
    } catch (error) {
      this.log(`Error loading Route53 health checks: ${error}`, 'error');
      throw error;
    }
  }

  parseFilter(rawFilter: string): ResourceFilter[] {
    const filters: ResourceFilter[] = [];
    
    if (!rawFilter.includes('Name=') && rawFilter.includes('=')) {
      const [serviceName, resourcesId] = rawFilter.split('=');
      filters.push({
        serviceName,
        fieldPath: 'id',
        acceptableValues: resourcesId.split(':'),
        isApplicable: (resourceName: string) => serviceName === '' || serviceName === resourceName
      });
    } else {
      const parts = rawFilter.split(';');
      if (parts.length >= 1) {
        const serviceName = parts[0].startsWith('Type=') ? parts[0].substring(5) : '';
        const fieldPath = parts[1]?.startsWith('Name=') ? parts[1].substring(5) : parts[0];
        const acceptableValues = parts[2]?.startsWith('Value=') ? 
          parts[2].substring(6).split(':') : undefined;

        filters.push({
          serviceName,
          fieldPath,
          acceptableValues: acceptableValues || [],
          isApplicable: (resourceName: string) => serviceName === '' || serviceName === resourceName
        });
      }
    }

    return filters;
  }

  async postConvertHook(): Promise<void> {
    this.log('Running Route53 post-conversion hook...', 'debug');
    
    // Post-process resources to replace zone IDs with references
    for (const resource of this.resources) {
      if (resource.type === 'aws_route53_record') {
        const zoneId = resource.attributes.zone_id;
        
        // Find the corresponding zone resource and replace with reference
        for (const zoneResource of this.resources) {
          if (zoneResource.type === 'aws_route53_zone' && zoneResource.additionalFields?.zone_id === zoneId) {
            resource.attributes.zone_id = `\${aws_route53_zone.${zoneResource.name}.zone_id}`;
            break;
          }
        }
        
        // Remove TTL if alias is present
        if (resource.additionalFields?.alias) {
          delete resource.attributes.ttl;
        }
      }
      
      if (resource.type === 'aws_route53_health_check') {
        // Remove child_health_threshold if no child health checks
        if (!resource.additionalFields?.child_healthchecks || resource.additionalFields.child_healthchecks.length === 0) {
          if (resource.additionalFields?.child_health_threshold) {
            delete resource.attributes.child_health_threshold;
          }
        }
      }
    }
  }

  private wildcardUnescape(s: string): string {
    if (s.includes('\\052')) {
      return s.replace('\\052', '*');
    }
    return s;
  }

  private cleanZoneId(id: string): string {
    return id.replace('/hostedzone/', '');
  }
}

