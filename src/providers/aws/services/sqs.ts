import { BaseService } from '../../../core/provider';
import { TerraformResource, ResourceFilter, ProviderConfig, Logger } from '../../../types';
import { SQSClient, ListQueuesCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';

export class SQSService extends BaseService {
  private client: SQSClient;

  constructor(providerName: string, serviceName: string, config: ProviderConfig, logger: Logger) {
    super(providerName, serviceName, config, logger);
    this.client = new SQSClient({
      region: config.region || 'us-east-1',
      credentials: config.credentials ? {
        accessKeyId: config.credentials.accessKeyId || '',
        secretAccessKey: config.credentials.secretAccessKey || '',
        sessionToken: config.credentials.sessionToken || undefined
      } : undefined
    });
  }

  async initResources(): Promise<void> {
    await this.loadQueues();
  }

  private async loadQueues(): Promise<void> {
    try {
      this.log('Loading SQS queues...', 'info');
      
      const command = new ListQueuesCommand({});
      const response = await this.client.send(command);
      
      let queueCount = 0;
      for (const queueUrl of response.QueueUrls || []) {
        const queueName = queueUrl.split('/').pop() || queueUrl;
        
        const resource = this.createResource(
          queueUrl,
          queueName,
          'sqs_queue',
          {
            name: queueName,
            url: queueUrl
          },
          {
            url: queueUrl
          }
        );
        
        this.addResource(resource);
        queueCount++;
      }
      
      this.log(`Loaded ${queueCount} SQS queues`, 'info');
    } catch (error) {
      this.log(`Error loading SQS queues: ${error}`, 'error');
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
    this.log('Running SQS post-conversion hook...', 'debug');
    
    // Post-process resources to format policy as heredoc
    for (const resource of this.resources) {
      if (resource.type === 'aws_sqs_queue' && resource.attributes.policy) {
        const policy = this.escapeAwsInterpolation(resource.attributes.policy);
        resource.attributes.policy = `<<POLICY
${policy}
POLICY`;
      }
    }
  }

  private escapeAwsInterpolation(policy: string): string {
    return policy.replace(/\$\{/g, '$${');
  }
}
