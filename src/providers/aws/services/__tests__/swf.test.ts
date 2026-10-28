import { mockClient } from 'aws-sdk-client-mock';
import { SWFClient, ListDomainsCommand } from '@aws-sdk/client-swf';
import { SWFService } from '../swf';
import { createService, importIds } from './helpers';

const swf = mockClient(SWFClient);

beforeEach(() => swf.reset());

describe('SWFService', () => {
  it('imports registered domains by name across pages', async () => {
    swf.on(ListDomainsCommand)
      .resolvesOnce({ domainInfos: [{ name: 'orders', status: 'REGISTERED' }], nextPageToken: 'p2' })
      .resolvesOnce({ domainInfos: [{ name: 'billing', status: 'REGISTERED' }] });

    const service = createService(SWFService, 'swf');
    await service.initResources();

    expect(importIds(service)).toEqual(['aws_swf_domain:billing', 'aws_swf_domain:orders']);
    const calls = swf.commandCalls(ListDomainsCommand);
    expect(calls[0].args[0].input).toMatchObject({ registrationStatus: 'REGISTERED' });
    expect(calls[1].args[0].input).toMatchObject({ registrationStatus: 'REGISTERED', nextPageToken: 'p2' });
  });
});
