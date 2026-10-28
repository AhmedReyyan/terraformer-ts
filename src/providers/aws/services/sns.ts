import { SNSClient, paginateListTopics, paginateListSubscriptions } from '@aws-sdk/client-sns';
import { AwsService, arnResourceName } from '../aws-service';

/** Subscription "ARNs" that are placeholders, not real subscriptions. */
const NON_IMPORTABLE_SUBSCRIPTIONS = new Set(['PendingConfirmation', 'Deleted']);

export class SNSService extends AwsService {
  async initResources(): Promise<void> {
    const sns = this.client(SNSClient);

    await this.collect('SNS topics', async () => {
      for await (const page of paginateListTopics({ client: sns }, {})) {
        for (const topic of page.Topics || []) {
          // The topic policy is the `policy` argument of aws_sns_topic, so aws_sns_topic_policy is not imported separately.
          const arn = topic.TopicArn!;
          const name = arnResourceName(arn);
          this.add('aws_sns_topic', arn, name, { name, arn });
        }
      }
    });

    await this.collect('SNS subscriptions', async () => {
      for await (const page of paginateListSubscriptions({ client: sns }, {})) {
        for (const subscription of page.Subscriptions || []) {
          const arn = subscription.SubscriptionArn;
          // Unconfirmed subscriptions have no ARN yet and cannot be imported.
          if (!arn || NON_IMPORTABLE_SUBSCRIPTIONS.has(arn)) {
            continue;
          }
          const topicName = arnResourceName(subscription.TopicArn || '');
          this.add('aws_sns_topic_subscription', arn, `${topicName}_${subscription.Protocol}`, {
            arn,
            topic_arn: subscription.TopicArn,
            protocol: subscription.Protocol
          });
        }
      }
    });
  }
}
