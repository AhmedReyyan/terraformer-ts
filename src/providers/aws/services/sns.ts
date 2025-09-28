import { BaseService } from '../../../core/provider';
import { TerraformResource, ResourceFilter, ProviderConfig, Logger } from '../../../types';
import { SNSClient, ListTopicsCommand, ListSubscriptionsByTopicCommand } from '@aws-sdk/client-sns';

export class SNSService extends BaseService {
  private client: SNSClient;

  constructor(providerName: string, serviceName: string, config: ProviderConfig, logger: Logger) {
    super(providerName, serviceName, config, logger);
    this.client = new SNSClient({
      region: config.region || 'us-east-1',
      credentials: config.credentials ? {
        accessKeyId: config.credentials.accessKeyId || '',
        secretAccessKey: config.credentials.secretAccessKey || '',
        sessionToken: config.credentials.sessionToken || undefined
      } : undefined
    });
  }

  async initResources(): Promise<void> {
    await this.loadTopics();
  }

  private async loadTopics(): Promise<void> {
    try {
      this.log('Loading SNS topics...', 'info');
      
      const command = new ListTopicsCommand({});
      const response = await this.client.send(command);
      
      let topicCount = 0;
      for (const topic of response.Topics || []) {
        if (topic.TopicArn) {
          const topicName = topic.TopicArn.split(':').pop() || topic.TopicArn;
          
          const resource = this.createResource(
            topic.TopicArn,
            topicName,
            'sns_topic',
            {
              name: topicName
            },
            {
              arn: topic.TopicArn,
              name: topicName
            }
          );
          
          this.addResource(resource);
          topicCount++;
          
          // Load subscriptions for this topic
          await this.loadSubscriptions(topic.TopicArn);
        }
      }
      
      this.log(`Loaded ${topicCount} SNS topics`, 'info');
    } catch (error) {
      this.log(`Error loading SNS topics: ${error}`, 'error');
      throw error;
    }
  }

  private async loadSubscriptions(topicArn: string): Promise<void> {
    try {
      const command = new ListSubscriptionsByTopicCommand({ TopicArn: topicArn });
      const response = await this.client.send(command);
      
      for (const subscription of response.Subscriptions || []) {
        if (subscription.SubscriptionArn && subscription.SubscriptionArn !== 'PendingConfirmation') {
          const resource = this.createResource(
            subscription.SubscriptionArn,
            subscription.SubscriptionArn,
            'sns_topic_subscription',
            {
              topic_arn: topicArn,
              protocol: subscription.Protocol,
              endpoint: subscription.Endpoint
            },
            {
              arn: subscription.SubscriptionArn,
              owner: subscription.Owner
            }
          );
          
          this.addResource(resource);
        }
      }
    } catch (error) {
      this.log(`Error loading subscriptions for topic ${topicArn}: ${error}`, 'debug');
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
    this.log('Running SNS post-conversion hook...', 'debug');
    
    // Post-process resources to format policy as heredoc
    for (const resource of this.resources) {
      if (resource.type === 'aws_sns_topic' && resource.attributes.policy) {
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

