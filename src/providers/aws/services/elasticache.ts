import {
  ElastiCacheClient,
  paginateDescribeReplicationGroups,
  paginateDescribeCacheClusters,
  paginateDescribeCacheSubnetGroups,
  paginateDescribeCacheParameterGroups,
  paginateDescribeUsers,
  paginateDescribeUserGroups,
  paginateDescribeServerlessCaches,
  paginateDescribeGlobalReplicationGroups
} from '@aws-sdk/client-elasticache';
import { AwsService } from '../aws-service';

/** Statuses of objects that are going away or never came up; they are not imported. */
const SKIPPED_STATUSES = new Set(['deleting', 'create-failed']);

export class ElastiCacheService extends AwsService {
  async initResources(): Promise<void> {
    const elasticache = this.client(ElastiCacheClient);

    await this.collect('ElastiCache replication groups', async () => {
      for await (const page of paginateDescribeReplicationGroups({ client: elasticache }, {})) {
        for (const group of page.ReplicationGroups || []) {
          const id = group.ReplicationGroupId;
          if (!id || SKIPPED_STATUSES.has(group.Status || '')) {
            continue;
          }
          this.add('aws_elasticache_replication_group', id, id, {
            replication_group_id: id,
            arn: group.ARN,
            global_replication_group_id: group.GlobalReplicationGroupInfo?.GlobalReplicationGroupId
          });
        }
      }
    });

    await this.collect('ElastiCache clusters', async () => {
      for await (const page of paginateDescribeCacheClusters({ client: elasticache }, {})) {
        for (const cluster of page.CacheClusters || []) {
          const id = cluster.CacheClusterId;
          // Member nodes of a replication group are managed by aws_elasticache_replication_group.
          if (!id || cluster.ReplicationGroupId || SKIPPED_STATUSES.has(cluster.CacheClusterStatus || '')) {
            continue;
          }
          this.add('aws_elasticache_cluster', id, id, { cluster_id: id, arn: cluster.ARN, engine: cluster.Engine });
        }
      }
    });

    await this.collect('ElastiCache serverless caches', async () => {
      for await (const page of paginateDescribeServerlessCaches({ client: elasticache }, {})) {
        for (const cache of page.ServerlessCaches || []) {
          const name = cache.ServerlessCacheName;
          if (!name || SKIPPED_STATUSES.has(cache.Status || '')) {
            continue;
          }
          this.add('aws_elasticache_serverless_cache', name, name, { name, arn: cache.ARN, engine: cache.Engine });
        }
      }
    });

    await this.collect('ElastiCache global replication groups', async () => {
      for await (const page of paginateDescribeGlobalReplicationGroups({ client: elasticache }, { ShowMemberInfo: true })) {
        for (const group of page.GlobalReplicationGroups || []) {
          const id = group.GlobalReplicationGroupId;
          // Visible from every member region: imported only in the primary member's region.
          const primary = group.Members?.find(member => member.Role === 'PRIMARY');
          if (!id || SKIPPED_STATUSES.has(group.Status || '') || primary?.ReplicationGroupRegion !== this.region) {
            continue;
          }
          this.add('aws_elasticache_global_replication_group', id, id, {
            global_replication_group_id: id,
            arn: group.ARN,
            primary_replication_group_id: primary.ReplicationGroupId
          });
        }
      }
    });

    await this.collect('ElastiCache subnet groups', async () => {
      for await (const page of paginateDescribeCacheSubnetGroups({ client: elasticache }, {})) {
        for (const group of page.CacheSubnetGroups || []) {
          const name = group.CacheSubnetGroupName;
          // `default` is the AWS-created subnet group of the default VPC.
          if (!name || name === 'default') {
            continue;
          }
          this.add('aws_elasticache_subnet_group', name, name, { name, arn: group.ARN, vpc_id: group.VpcId });
        }
      }
    });

    await this.collect('ElastiCache parameter groups', async () => {
      for await (const page of paginateDescribeCacheParameterGroups({ client: elasticache }, {})) {
        for (const group of page.CacheParameterGroups || []) {
          const name = group.CacheParameterGroupName;
          // `default.*` groups are AWS-managed; global groups are created by global datastores.
          if (!name || name.startsWith('default.') || group.IsGlobal) {
            continue;
          }
          this.add('aws_elasticache_parameter_group', name, name, {
            name, arn: group.ARN, family: group.CacheParameterGroupFamily
          });
        }
      }
    });

    await this.collect('ElastiCache users', async () => {
      for await (const page of paginateDescribeUsers({ client: elasticache }, {})) {
        for (const user of page.Users || []) {
          const id = user.UserId;
          // `default` is the built-in user that exists in every account.
          if (!id || id === 'default' || user.Status === 'deleting') {
            continue;
          }
          this.add('aws_elasticache_user', id, user.UserName || id, {
            user_id: id, user_name: user.UserName, arn: user.ARN, engine: user.Engine
          });
        }
      }
    });

    await this.collect('ElastiCache user groups', async () => {
      for await (const page of paginateDescribeUserGroups({ client: elasticache }, {})) {
        for (const group of page.UserGroups || []) {
          const id = group.UserGroupId;
          // Membership is part of aws_elasticache_user_group (user_ids), so
          // aws_elasticache_user_group_association is not imported.
          if (!id || group.Status === 'deleting') {
            continue;
          }
          this.add('aws_elasticache_user_group', id, id, { user_group_id: id, arn: group.ARN, engine: group.Engine });
        }
      }
    });
  }
}
