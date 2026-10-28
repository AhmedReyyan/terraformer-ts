import { mockClient } from 'aws-sdk-client-mock';
import {
  MemoryDBClient,
  DescribeClustersCommand,
  DescribeSubnetGroupsCommand,
  DescribeParameterGroupsCommand,
  DescribeUsersCommand,
  DescribeACLsCommand
} from '@aws-sdk/client-memorydb';
import { MemoryDBService } from '../memorydb';
import { createService, importIds } from './helpers';

const memorydb = mockClient(MemoryDBClient);

beforeEach(() => {
  memorydb.reset();
  memorydb.onAnyCommand().resolves({});
});

describe('MemoryDBService', () => {
  it('imports clusters and supporting objects, skipping defaults and built-ins', async () => {
    memorydb.on(DescribeClustersCommand)
      .resolvesOnce({ Clusters: [{ Name: 'cache-a' }], NextToken: 't' })
      .resolves({ Clusters: [{ Name: 'cache-b' }, { Name: 'cache-old', Status: 'deleting' }] });
    memorydb.on(DescribeSubnetGroupsCommand).resolves({ SubnetGroups: [{ Name: 'mem-net' }, { Name: 'default' }] });
    memorydb.on(DescribeParameterGroupsCommand).resolves({
      ParameterGroups: [{ Name: 'custom-params' }, { Name: 'default.memorydb-redis7' }]
    });
    memorydb.on(DescribeUsersCommand).resolves({ Users: [{ Name: 'default' }, { Name: 'app' }] });
    memorydb.on(DescribeACLsCommand).resolves({ ACLs: [{ Name: 'open-access' }, { Name: 'app-acl' }] });

    const service = createService(MemoryDBService, 'memorydb', 'eu-west-1');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_memorydb_acl:app-acl',
      'aws_memorydb_cluster:cache-a',
      'aws_memorydb_cluster:cache-b',
      'aws_memorydb_parameter_group:custom-params',
      'aws_memorydb_subnet_group:mem-net',
      'aws_memorydb_user:app'
    ]);
    expect(memorydb.commandCalls(DescribeClustersCommand)[1].args[0].input).toMatchObject({ NextToken: 't' });
    expect(service.getWarnings()).toEqual([]);
  });
});
