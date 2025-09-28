import { BaseService } from '../../../core/provider';
import { TerraformResource, ResourceFilter, ProviderConfig, Logger } from '../../../types';
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';

export class S3Service extends BaseService {
  private client: S3Client;

  constructor(providerName: string, serviceName: string, config: ProviderConfig, logger: Logger) {
    super(providerName, serviceName, config, logger);
    this.client = new S3Client({
      region: config.region || 'us-east-1',
      credentials: config.credentials ? {
        accessKeyId: config.credentials.accessKeyId || '',
        secretAccessKey: config.credentials.secretAccessKey || '',
        sessionToken: config.credentials.sessionToken || undefined
      } : undefined // Let AWS SDK use environment variables
    });
  }

  async initResources(): Promise<void> {
    await this.loadBuckets();
  }

  private async loadBuckets(): Promise<void> {
    try {
      this.log('Loading S3 buckets...', 'info');
      
      const command = new ListBucketsCommand({});
      const response = await this.client.send(command);
      
      let bucketCount = 0;
      for (const bucket of response.Buckets || []) {
        if (bucket.Name) {
          const resource = this.createResource(
            bucket.Name,
            bucket.Name,
            's3_bucket',
            {
              bucket: bucket.Name,
              arn: `arn:aws:s3:::${bucket.Name}`
            },
            {
              creation_date: bucket.CreationDate
            }
          );
          
          this.addResource(resource);
          bucketCount++;
        }
      }
      
      this.log(`Loaded ${bucketCount} S3 buckets`, 'info');
    } catch (error) {
      this.log(`Error loading S3 buckets: ${error}`, 'error');
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
    this.log('Running S3 post-conversion hook...', 'debug');
  }
}
