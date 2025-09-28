import { BaseService } from '../../../core/provider';
import { TerraformResource, ResourceFilter, ProviderConfig, Logger } from '../../../types';
import { CloudFrontClient, ListDistributionsCommand, ListCachePoliciesCommand } from '@aws-sdk/client-cloudfront';

export class CloudFrontService extends BaseService {
  private client: CloudFrontClient;

  constructor(providerName: string, serviceName: string, config: ProviderConfig, logger: Logger) {
    super(providerName, serviceName, config, logger);
    this.client = new CloudFrontClient({
      region: config.region || 'us-east-1',
      credentials: config.credentials ? {
        accessKeyId: config.credentials.accessKeyId || '',
        secretAccessKey: config.credentials.secretAccessKey || '',
        sessionToken: config.credentials.sessionToken || undefined
      } : undefined
    });
  }

  async initResources(): Promise<void> {
    await this.loadDistributions();
    await this.loadCachePolicies();
  }

  private async loadDistributions(): Promise<void> {
    try {
      this.log('Loading CloudFront distributions...', 'info');
      
      const command = new ListDistributionsCommand({});
      const response = await this.client.send(command);
      
      let distributionCount = 0;
      for (const distribution of response.DistributionList?.Items || []) {
        if (distribution.Id) {
          const resource = this.createResource(
            distribution.Id,
            distribution.Id,
            'cloudfront_distribution',
            {
              retain_on_delete: false
            },
            {
              id: distribution.Id,
              arn: distribution.ARN,
              domain_name: distribution.DomainName,
              status: distribution.Status,
              last_modified_time: distribution.LastModifiedTime
            }
          );
          
          this.addResource(resource);
          distributionCount++;
        }
      }
      
      this.log(`Loaded ${distributionCount} CloudFront distributions`, 'info');
    } catch (error) {
      this.log(`Error loading CloudFront distributions: ${error}`, 'error');
      throw error;
    }
  }

  private async loadCachePolicies(): Promise<void> {
    try {
      this.log('Loading CloudFront cache policies...', 'info');
      
      let marker: string | undefined;
      let cachePolicyCount = 0;
      
      do {
        const command = new ListCachePoliciesCommand({
          Marker: marker
        });
        const response = await this.client.send(command);
        
        for (const cachePolicy of response.CachePolicyList?.Items || []) {
          if (cachePolicy.CachePolicy?.Id) {
            const resource = this.createResource(
              cachePolicy.CachePolicy.Id,
              cachePolicy.CachePolicy.Id,
              'cloudfront_cache_policy',
              {},
              {
                id: cachePolicy.CachePolicy.Id,
                name: cachePolicy.CachePolicy.CachePolicyConfig?.Name,
                comment: cachePolicy.CachePolicy.CachePolicyConfig?.Comment
              }
            );
            
            this.addResource(resource);
            cachePolicyCount++;
          }
        }
        
        marker = response.CachePolicyList?.NextMarker;
      } while (marker);
      
      this.log(`Loaded ${cachePolicyCount} CloudFront cache policies`, 'info');
    } catch (error) {
      this.log(`Error loading CloudFront cache policies: ${error}`, 'error');
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
    this.log('Running CloudFront post-conversion hook...', 'debug');
    
    // Post-process resources to replace cache policy IDs with references
    for (const resource of this.resources) {
      if (resource.type === 'aws_cloudfront_distribution') {
        // Replace cache policy IDs with references to cache policy resources
        for (const cachePolicyResource of this.resources) {
          if (cachePolicyResource.type === 'aws_cloudfront_cache_policy') {
            // This would need to be implemented based on the actual structure
            // of the distribution configuration
          }
        }
      }
    }
  }
}

