import { mockClient } from 'aws-sdk-client-mock';
import { ResourceGroupsClient, ListGroupsCommand } from '@aws-sdk/client-resource-groups';
import { ResourceGroupsService } from '../resourcegroups';
import { createService, importIds } from './helpers';

const resourceGroups = mockClient(ResourceGroupsClient);

beforeEach(() => resourceGroups.reset());

describe('ResourceGroupsService', () => {
  it('imports resource groups across pages and skips AWS-reserved names', async () => {
    resourceGroups.on(ListGroupsCommand)
      .resolvesOnce({ GroupIdentifiers: [{ GroupName: 'prod-web' }, { GroupName: 'AWS_AppRegistry_Application-shop' }], NextToken: 'p2' })
      .resolvesOnce({ GroupIdentifiers: [{ GroupName: 'billing' }] });

    const service = createService(ResourceGroupsService, 'resourcegroups');
    await service.initResources();

    expect(importIds(service)).toEqual(['aws_resourcegroups_group:billing', 'aws_resourcegroups_group:prod-web']);
    expect(resourceGroups.commandCalls(ListGroupsCommand)[1].args[0].input).toMatchObject({ NextToken: 'p2' });
    expect(service.getWarnings()).toEqual([]);
  });
});
