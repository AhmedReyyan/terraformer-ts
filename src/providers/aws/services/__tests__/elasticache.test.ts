import { mockClient } from 'aws-sdk-client-mock';
import {
  ElastiCacheClient,
  DescribeReplicationGroupsCommand,
  DescribeCacheClustersCommand,
  DescribeServerlessCachesCommand,
  DescribeGlobalReplicationGroupsCommand,
  DescribeCacheSubnetGroupsCommand,
  DescribeCacheParameterGroupsCommand,
  DescribeUsersCommand,
  DescribeUserGroupsCommand
} from '@aws-sdk/client-elasticache';
import { ElastiCacheService } from '../elasticache';
import { createService, importIds } from './helpers';

const elasticache = mockClient(ElastiCacheClient);

beforeEach(() => {
  elasticache.reset();
  elasticache.onAnyCommand().resolves({});
});

describe('ElastiCacheService', () => {
  it('imports caches and their supporting objects, skipping members, defaults and built-ins', async () => {
    elasticache.on(DescribeReplicationGroupsCommand)
      .resolvesOnce({ ReplicationGroups: [{ ReplicationGroupId: 'sessions', Status: 'available' }], Marker: 'm' })
      .resolves({ ReplicationGroups: [{ ReplicationGroupId: 'old', Status: 'deleting' }, { ReplicationGroupId: 'secondary' }] });
    elasticache.on(DescribeCacheClustersCommand).resolves({
      CacheClusters: [
        { CacheClusterId: 'memcached', CacheClusterStatus: 'available' },
        { CacheClusterId: 'sessions-001', ReplicationGroupId: 'sessions' },
        { CacheClusterId: 'broken', CacheClusterStatus: 'create-failed' }
      ]
    });
    elasticache.on(DescribeServerlessCachesCommand).resolves({ ServerlessCaches: [{ ServerlessCacheName: 'serverless' }] });
    elasticache.on(DescribeGlobalReplicationGroupsCommand).resolves({
      GlobalReplicationGroups: [
        { GlobalReplicationGroupId: 'abcde-global', Members: [
          { ReplicationGroupId: 'sessions', ReplicationGroupRegion: 'eu-west-1', Role: 'PRIMARY' },
          { ReplicationGroupId: 'secondary', ReplicationGroupRegion: 'us-east-1', Role: 'SECONDARY' }
        ] },
        { GlobalReplicationGroupId: 'fghij-remote', Members: [
          { ReplicationGroupId: 'x', ReplicationGroupRegion: 'us-east-1', Role: 'PRIMARY' }
        ] }
      ]
    });
    elasticache.on(DescribeCacheSubnetGroupsCommand).resolves({
      CacheSubnetGroups: [{ CacheSubnetGroupName: 'cache-net' }, { CacheSubnetGroupName: 'default' }]
    });
    elasticache.on(DescribeCacheParameterGroupsCommand).resolves({
      CacheParameterGroups: [
        { CacheParameterGroupName: 'redis7-custom' },
        { CacheParameterGroupName: 'default.redis7' },
        { CacheParameterGroupName: 'global-datastore-abcde', IsGlobal: true }
      ]
    });
    elasticache.on(DescribeUsersCommand).resolves({
      Users: [{ UserId: 'default', UserName: 'default' }, { UserId: 'app-user', UserName: 'app' }]
    });
    elasticache.on(DescribeUserGroupsCommand).resolves({ UserGroups: [{ UserGroupId: 'app-group' }] });

    const service = createService(ElastiCacheService, 'elasticache', 'eu-west-1');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_elasticache_cluster:memcached',
      'aws_elasticache_global_replication_group:abcde-global',
      'aws_elasticache_parameter_group:redis7-custom',
      'aws_elasticache_replication_group:secondary',
      'aws_elasticache_replication_group:sessions',
      'aws_elasticache_serverless_cache:serverless',
      'aws_elasticache_subnet_group:cache-net',
      'aws_elasticache_user:app-user',
      'aws_elasticache_user_group:app-group'
    ]);
    expect(elasticache.commandCalls(DescribeReplicationGroupsCommand)[1].args[0].input).toMatchObject({ Marker: 'm' });
    expect(elasticache.commandCalls(DescribeGlobalReplicationGroupsCommand)[0].args[0].input).toMatchObject({ ShowMemberInfo: true });
    expect(service.getWarnings()).toEqual([]);
  });
});
