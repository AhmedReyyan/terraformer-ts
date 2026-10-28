import { mockClient } from 'aws-sdk-client-mock';
import { SNSClient, ListTopicsCommand, ListSubscriptionsCommand } from '@aws-sdk/client-sns';
import { SNSService } from '../sns';
import { createService, importIds } from './helpers';

const sns = mockClient(SNSClient);

beforeEach(() => sns.reset());

describe('SNSService', () => {
  it('imports topics (all pages) and confirmed subscriptions by ARN', async () => {
    sns.on(ListTopicsCommand)
      .resolvesOnce({ Topics: [{ TopicArn: 'arn:aws:sns:us-east-1:123:orders' }], NextToken: 't2' })
      .resolvesOnce({ Topics: [{ TopicArn: 'arn:aws:sns:us-east-1:123:alerts.fifo' }] });
    sns.on(ListSubscriptionsCommand).resolves({
      Subscriptions: [
        { SubscriptionArn: 'arn:aws:sns:us-east-1:123:orders:1111', TopicArn: 'arn:aws:sns:us-east-1:123:orders', Protocol: 'sqs' },
        { SubscriptionArn: 'PendingConfirmation', TopicArn: 'arn:aws:sns:us-east-1:123:orders', Protocol: 'email' },
        { SubscriptionArn: 'Deleted', TopicArn: 'arn:aws:sns:us-east-1:123:orders', Protocol: 'email' }
      ]
    });

    const service = createService(SNSService, 'sns');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_sns_topic:arn:aws:sns:us-east-1:123:alerts.fifo',
      'aws_sns_topic:arn:aws:sns:us-east-1:123:orders',
      'aws_sns_topic_subscription:arn:aws:sns:us-east-1:123:orders:1111'
    ]);
    expect(sns.commandCalls(ListTopicsCommand)[1].args[0].input).toMatchObject({ NextToken: 't2' });
    expect(service.getWarnings()).toEqual([]);
  });

  it('keeps topics when subscriptions cannot be listed', async () => {
    sns.on(ListTopicsCommand).resolves({ Topics: [{ TopicArn: 'arn:aws:sns:us-east-1:123:orders' }] });
    sns.on(ListSubscriptionsCommand).rejects(Object.assign(new Error('denied'), { name: 'AuthorizationError' }));

    const service = createService(SNSService, 'sns');
    await service.initResources();

    expect(importIds(service)).toEqual(['aws_sns_topic:arn:aws:sns:us-east-1:123:orders']);
    expect(service.getWarnings()[0]).toContain('AuthorizationError');
  });
});
