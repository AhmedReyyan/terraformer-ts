import { mockClient } from 'aws-sdk-client-mock';
import { KinesisClient, ListStreamsCommand, ListStreamConsumersCommand } from '@aws-sdk/client-kinesis';
import { KinesisService } from '../kinesis';
import { createService, importIds } from './helpers';

const kinesis = mockClient(KinesisClient);
const streamArn = (name: string) => `arn:aws:kinesis:us-east-1:123:stream/${name}`;
const summary = (name: string, status = 'ACTIVE') => ({
  StreamName: name, StreamARN: streamArn(name), StreamStatus: status as any, StreamCreationTimestamp: new Date()
});

beforeEach(() => kinesis.reset());

describe('KinesisService', () => {
  it('imports streams by name and consumers by ARN, following pagination and skipping deleting ones', async () => {
    kinesis.on(ListStreamsCommand).resolvesOnce({
      StreamNames: ['orders'], StreamSummaries: [summary('orders')], HasMoreStreams: true, NextToken: 'p2'
    }).resolvesOnce({
      StreamNames: ['old'], StreamSummaries: [summary('old', 'DELETING')], HasMoreStreams: false
    });
    const consumerArn = `${streamArn('orders')}/consumer/app:1616044553`;
    kinesis.on(ListStreamConsumersCommand).resolves({
      Consumers: [
        { ConsumerName: 'app', ConsumerARN: consumerArn, ConsumerStatus: 'ACTIVE', ConsumerCreationTimestamp: new Date() },
        { ConsumerName: 'gone', ConsumerARN: `${consumerArn}x`, ConsumerStatus: 'DELETING', ConsumerCreationTimestamp: new Date() }
      ]
    });

    const service = createService(KinesisService, 'kinesis');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_kinesis_stream:orders',
      `aws_kinesis_stream_consumer:${consumerArn}`
    ]);
    expect(kinesis.commandCalls(ListStreamsCommand)[1].args[0].input).toMatchObject({ NextToken: 'p2' });
    expect(kinesis.commandCalls(ListStreamConsumersCommand)).toHaveLength(1);
    expect(service.getWarnings()).toEqual([]);
  });
});
