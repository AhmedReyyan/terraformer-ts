import { mockClient } from 'aws-sdk-client-mock';
import { CloudTrailClient, ListEventDataStoresCommand, ListTrailsCommand } from '@aws-sdk/client-cloudtrail';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { CloudTrailService } from '../cloudtrail';
import { createService, importIds } from './helpers';

const cloudtrail = mockClient(CloudTrailClient);
const sts = mockClient(STSClient);

beforeEach(() => {
  cloudtrail.reset();
  sts.reset();
  sts.on(GetCallerIdentityCommand).resolves({ Account: '123456789012' });
});

describe('CloudTrailService', () => {
  it('imports trails only in their home region and owning account, and active event data stores', async () => {
    cloudtrail.on(ListTrailsCommand)
      .resolvesOnce({
        Trails: [
          { Name: 'main', HomeRegion: 'eu-west-1', TrailARN: 'arn:aws:cloudtrail:eu-west-1:123456789012:trail/main' },
          { Name: 'global', HomeRegion: 'us-east-1', TrailARN: 'arn:aws:cloudtrail:us-east-1:123456789012:trail/global' }
        ],
        NextToken: 'p2'
      })
      .resolvesOnce({
        Trails: [
          { Name: 'org-trail', HomeRegion: 'eu-west-1', TrailARN: 'arn:aws:cloudtrail:eu-west-1:999999999999:trail/org-trail' },
          { Name: 'audit', HomeRegion: 'eu-west-1', TrailARN: 'arn:aws:cloudtrail:eu-west-1:123456789012:trail/audit' }
        ]
      });
    cloudtrail.on(ListEventDataStoresCommand).resolves({
      EventDataStores: [
        { Name: 'lake', EventDataStoreArn: 'arn:aws:cloudtrail:eu-west-1:123456789012:eventdatastore/abc', Status: 'ENABLED' },
        { Name: 'old', EventDataStoreArn: 'arn:aws:cloudtrail:eu-west-1:123456789012:eventdatastore/def', Status: 'PENDING_DELETION' }
      ]
    });

    const service = createService(CloudTrailService, 'cloudtrail', 'eu-west-1');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_cloudtrail:arn:aws:cloudtrail:eu-west-1:123456789012:trail/audit',
      'aws_cloudtrail:arn:aws:cloudtrail:eu-west-1:123456789012:trail/main',
      'aws_cloudtrail_event_data_store:arn:aws:cloudtrail:eu-west-1:123456789012:eventdatastore/abc'
    ]);
    expect(cloudtrail.commandCalls(ListTrailsCommand)[1].args[0].input).toMatchObject({ NextToken: 'p2' });
    expect(service.getWarnings()).toEqual([]);
  });
});
