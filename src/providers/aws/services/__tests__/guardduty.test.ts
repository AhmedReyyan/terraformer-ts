import { mockClient } from 'aws-sdk-client-mock';
import {
  GuardDutyClient,
  ListDetectorsCommand,
  ListFiltersCommand,
  ListIPSetsCommand,
  ListThreatIntelSetsCommand,
  ListPublishingDestinationsCommand
} from '@aws-sdk/client-guardduty';
import { GuardDutyService } from '../guardduty';
import { createService, importIds } from './helpers';

const gd = mockClient(GuardDutyClient);

beforeEach(() => gd.reset());

describe('GuardDutyService', () => {
  it('imports the detector and its children', async () => {
    gd.on(ListDetectorsCommand).resolves({ DetectorIds: ['d1'] });
    gd.on(ListFiltersCommand)
      .resolvesOnce({ FilterNames: ['f1'], NextToken: 'n' })
      .resolves({ FilterNames: ['f2'] });
    gd.on(ListIPSetsCommand).resolves({ IpSetIds: ['ip1'] });
    gd.on(ListThreatIntelSetsCommand).resolves({ ThreatIntelSetIds: ['ti1'] });
    gd.on(ListPublishingDestinationsCommand).resolves({
      Destinations: [{ DestinationId: 'pd1', DestinationType: 'S3', Status: 'PUBLISHING' }]
    });

    const service = createService(GuardDutyService, 'guardduty');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_guardduty_detector:d1',
      'aws_guardduty_filter:d1:f1',
      'aws_guardduty_filter:d1:f2',
      'aws_guardduty_ipset:d1:ip1',
      'aws_guardduty_publishing_destination:d1:pd1',
      'aws_guardduty_threatintelset:d1:ti1'
    ]);
    expect(gd.commandCalls(ListFiltersCommand)[1].args[0].input).toMatchObject({ DetectorId: 'd1', NextToken: 'n' });
    expect(service.getWarnings()).toEqual([]);
  });

  it('imports nothing when GuardDuty is not enabled', async () => {
    gd.on(ListDetectorsCommand).resolves({ DetectorIds: [] });
    const service = createService(GuardDutyService, 'guardduty');
    await service.initResources();
    expect(importIds(service)).toEqual([]);
  });
});
