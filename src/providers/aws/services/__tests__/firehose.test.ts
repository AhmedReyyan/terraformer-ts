import { mockClient } from 'aws-sdk-client-mock';
import { FirehoseClient, ListDeliveryStreamsCommand, DescribeDeliveryStreamCommand } from '@aws-sdk/client-firehose';
import { FirehoseService } from '../firehose';
import { createService, importIds } from './helpers';

const firehose = mockClient(FirehoseClient);
const arn = (name: string) => `arn:aws:firehose:us-east-1:123:deliverystream/${name}`;
const description = (name: string, status: string) => ({
  DeliveryStreamDescription: {
    DeliveryStreamName: name, DeliveryStreamARN: arn(name), DeliveryStreamStatus: status as any,
    DeliveryStreamType: 'DirectPut' as const, VersionId: '1', Destinations: [], HasMoreDestinations: false
  }
});

beforeEach(() => firehose.reset());

describe('FirehoseService', () => {
  it('imports delivery streams by ARN across pages and skips deleting/failed ones', async () => {
    firehose.on(ListDeliveryStreamsCommand).resolvesOnce({ DeliveryStreamNames: ['logs', 'old'], HasMoreDeliveryStreams: true })
      .resolvesOnce({ DeliveryStreamNames: ['broken'], HasMoreDeliveryStreams: false });
    firehose.on(DescribeDeliveryStreamCommand, { DeliveryStreamName: 'logs' }).resolves(description('logs', 'ACTIVE'));
    firehose.on(DescribeDeliveryStreamCommand, { DeliveryStreamName: 'old' }).resolves(description('old', 'DELETING'));
    firehose.on(DescribeDeliveryStreamCommand, { DeliveryStreamName: 'broken' }).resolves(description('broken', 'CREATING_FAILED'));

    const service = createService(FirehoseService, 'firehose');
    await service.initResources();

    expect(importIds(service)).toEqual([`aws_kinesis_firehose_delivery_stream:${arn('logs')}`]);
    expect(firehose.commandCalls(ListDeliveryStreamsCommand)[1].args[0].input)
      .toMatchObject({ ExclusiveStartDeliveryStreamName: 'old' });
    expect(service.getWarnings()).toEqual([]);
  });
});
