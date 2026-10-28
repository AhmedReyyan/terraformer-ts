import {
  RDSClient,
  DBCluster,
  DBInstance,
  paginateDescribeDBInstances,
  paginateDescribeDBClusters,
  paginateDescribeDBSubnetGroups,
  paginateDescribeDBParameterGroups,
  paginateDescribeDBClusterParameterGroups,
  paginateDescribeDBClusterEndpoints,
  paginateDescribeOptionGroups,
  paginateDescribeEventSubscriptions,
  paginateDescribeDBProxies,
  paginateDescribeDBProxyEndpoints,
  paginateDescribeDBProxyTargets,
  paginateDescribeGlobalClusters
} from '@aws-sdk/client-rds';
import { mapLimit } from '../../../core/provider';
import { AwsService, tagMap } from '../aws-service';

/**
 * The RDS, DocumentDB and Neptune APIs share one backend: DescribeDBClusters,
 * DescribeDBInstances, the subnet/parameter group calls and DescribeGlobalClusters of
 * each of them return the objects of all three engines. Each object is imported by
 * exactly one of the `rds`, `docdb` and `neptune` services, decided by these helpers.
 */
export type DbFamily = 'rds' | 'docdb' | 'neptune';

/** The owning service of an engine name (`docdb`, `neptune`, `aurora-mysql`) or parameter group family (`docdb5.0`, `neptune1.3`). */
export function dbFamily(engineOrFamily: string | undefined): DbFamily {
  const value = (engineOrFamily || '').toLowerCase();
  if (value.startsWith('docdb')) {
    return 'docdb';
  }
  if (value.startsWith('neptune')) {
    return 'neptune';
  }
  return 'rds';
}

export interface SubnetGroupUse {
  subnetGroup?: string;
  engine?: string;
}

/**
 * Subnet groups are one object for all three engines. A subnet group is owned by
 * `docdb` / `neptune` only when every cluster/instance using it has that engine;
 * unused or mixed-use subnet groups are owned by `rds` (aws_db_subnet_group).
 */
export function subnetGroupOwners(uses: SubnetGroupUse[]): Map<string, DbFamily> {
  const families = new Map<string, Set<DbFamily>>();
  for (const use of uses) {
    if (use.subnetGroup) {
      const set = families.get(use.subnetGroup) || new Set<DbFamily>();
      set.add(dbFamily(use.engine));
      families.set(use.subnetGroup, set);
    }
  }
  const owners = new Map<string, DbFamily>();
  for (const [name, set] of families) {
    owners.set(name, set.size === 1 ? [...set][0] : 'rds');
  }
  return owners;
}

/**
 * Global clusters are returned by DescribeGlobalClusters in every region. Import a
 * global cluster only in the region of its writer (primary) member cluster, so it is
 * imported once. Global clusters without a writer member are skipped.
 */
export function globalClusterHomeRegion(members: Array<{ DBClusterArn?: string; IsWriter?: boolean }> | undefined): string | undefined {
  const writer = members?.find(member => member.IsWriter && member.DBClusterArn);
  return writer?.DBClusterArn?.split(':')[3];
}

/** Statuses of objects that are going away or never came up; they are not imported. */
export const SKIPPED_DB_STATUSES = new Set(['deleting', 'failed']);

export class RDSService extends AwsService {
  async initResources(): Promise<void> {
    const rds = this.client(RDSClient);
    // Unfiltered: DocumentDB/Neptune objects are needed to decide subnet group ownership.
    const clusters: DBCluster[] = [];
    const instances: DBInstance[] = [];
    let usesComplete = true;

    await this.collect('RDS clusters', async () => {
      try {
        for await (const page of paginateDescribeDBClusters({ client: rds }, {})) {
          clusters.push(...(page.DBClusters || []));
        }
      } catch (error) {
        usesComplete = false;
        throw error;
      }
      for (const cluster of clusters) {
        const id = cluster.DBClusterIdentifier;
        if (!id || dbFamily(cluster.Engine) !== 'rds' || SKIPPED_DB_STATUSES.has(cluster.Status || '')) {
          continue;
        }
        this.add('aws_rds_cluster', id, id, {
          cluster_identifier: id,
          arn: cluster.DBClusterArn,
          engine: cluster.Engine,
          tags: tagMap(cluster.TagList)
        });
      }
    });

    await this.collect('RDS cluster endpoints', async () => {
      const rdsClusters = new Set(clusters.filter(c => dbFamily(c.Engine) === 'rds').map(c => c.DBClusterIdentifier));
      for await (const page of paginateDescribeDBClusterEndpoints({ client: rds }, {})) {
        for (const endpoint of page.DBClusterEndpoints || []) {
          const id = endpoint.DBClusterEndpointIdentifier;
          // Only custom endpoints are separate objects; the writer/reader endpoints belong to the cluster.
          if (!id || endpoint.EndpointType !== 'CUSTOM' || !rdsClusters.has(endpoint.DBClusterIdentifier)
            || endpoint.Status === 'deleting') {
            continue;
          }
          this.add('aws_rds_cluster_endpoint', id, id, {
            cluster_endpoint_identifier: id, cluster_identifier: endpoint.DBClusterIdentifier, arn: endpoint.DBClusterEndpointArn
          });
        }
      }
    });

    await this.collect('RDS instances', async () => {
      try {
        for await (const page of paginateDescribeDBInstances({ client: rds }, {})) {
          instances.push(...(page.DBInstances || []));
        }
      } catch (error) {
        usesComplete = false;
        throw error;
      }
      for (const instance of instances) {
        const id = instance.DBInstanceIdentifier;
        if (!id || dbFamily(instance.Engine) !== 'rds' || SKIPPED_DB_STATUSES.has(instance.DBInstanceStatus || '')) {
          continue;
        }
        const attributes = {
          identifier: id,
          arn: instance.DBInstanceArn,
          engine: instance.Engine,
          cluster_identifier: instance.DBClusterIdentifier,
          tags: tagMap(instance.TagList)
        };
        if (!instance.DBClusterIdentifier) {
          this.add('aws_db_instance', id, id, attributes);
        } else if ((instance.Engine || '').startsWith('aurora')) {
          this.add('aws_rds_cluster_instance', id, id, attributes);
        }
        // Members of Multi-AZ DB clusters (mysql/postgres with a cluster) are created and
        // managed by their aws_rds_cluster (db_cluster_instance_class), so they are skipped.
      }
    });

    await this.collect('RDS subnet groups', async () => {
      // Without the full cluster/instance list ownership is unknown: claim every group.
      const owners = usesComplete ? subnetGroupOwners(dbUses(clusters, instances)) : new Map<string, DbFamily>();
      for await (const page of paginateDescribeDBSubnetGroups({ client: rds }, {})) {
        for (const group of page.DBSubnetGroups || []) {
          const name = group.DBSubnetGroupName;
          // `default` is the AWS-created default subnet group of the default VPC.
          if (!name || name === 'default' || (owners.get(name) || 'rds') !== 'rds') {
            continue;
          }
          this.add('aws_db_subnet_group', name, name, { name, arn: group.DBSubnetGroupArn, vpc_id: group.VpcId });
        }
      }
    });

    await this.collect('RDS parameter groups', async () => {
      for await (const page of paginateDescribeDBParameterGroups({ client: rds }, {})) {
        for (const group of page.DBParameterGroups || []) {
          const name = group.DBParameterGroupName;
          // `default.*` groups are AWS-managed; Neptune groups belong to the neptune service.
          if (!name || name.startsWith('default.') || dbFamily(group.DBParameterGroupFamily) !== 'rds') {
            continue;
          }
          this.add('aws_db_parameter_group', name, name, {
            name, arn: group.DBParameterGroupArn, family: group.DBParameterGroupFamily
          });
        }
      }
    });

    await this.collect('RDS cluster parameter groups', async () => {
      for await (const page of paginateDescribeDBClusterParameterGroups({ client: rds }, {})) {
        for (const group of page.DBClusterParameterGroups || []) {
          const name = group.DBClusterParameterGroupName;
          // `default.*` groups are AWS-managed; DocumentDB/Neptune groups belong to their services.
          if (!name || name.startsWith('default.') || dbFamily(group.DBParameterGroupFamily) !== 'rds') {
            continue;
          }
          this.add('aws_rds_cluster_parameter_group', name, name, {
            name, arn: group.DBClusterParameterGroupArn, family: group.DBParameterGroupFamily
          });
        }
      }
    });

    await this.collect('RDS option groups', async () => {
      for await (const page of paginateDescribeOptionGroups({ client: rds }, {})) {
        for (const group of page.OptionGroupsList || []) {
          const name = group.OptionGroupName;
          // `default:<engine>-<version>` option groups are AWS-managed.
          if (!name || name.startsWith('default:')) {
            continue;
          }
          this.add('aws_db_option_group', name, name, { name, arn: group.OptionGroupArn, engine_name: group.EngineName });
        }
      }
    });

    await this.collect('RDS event subscriptions', async () => {
      // The subscription API is shared with DocumentDB/Neptune and has no engine field,
      // so all subscriptions are imported here as aws_db_event_subscription.
      for await (const page of paginateDescribeEventSubscriptions({ client: rds }, {})) {
        for (const subscription of page.EventSubscriptionsList || []) {
          const name = subscription.CustSubscriptionId;
          if (!name || subscription.Status === 'deleting') {
            continue;
          }
          this.add('aws_db_event_subscription', name, name, { name, arn: subscription.EventSubscriptionArn });
        }
      }
    });

    await this.collect('RDS proxies', async () => {
      const proxies: string[] = [];
      for await (const page of paginateDescribeDBProxies({ client: rds }, {})) {
        for (const proxy of page.DBProxies || []) {
          const name = proxy.DBProxyName;
          if (!name || proxy.Status === 'deleting') {
            continue;
          }
          proxies.push(name);
          this.add('aws_db_proxy', name, name, { name, arn: proxy.DBProxyArn, engine_family: proxy.EngineFamily });
          // Every proxy has exactly one target group, `default`, imported by proxy name.
          this.add('aws_db_proxy_default_target_group', name, name, { db_proxy_name: name });
        }
      }

      await mapLimit(proxies, 5, proxy => this.collect(`RDS proxy targets of ${proxy}`, async () => {
        for await (const page of paginateDescribeDBProxyTargets({ client: rds }, { DBProxyName: proxy, TargetGroupName: 'default' })) {
          for (const target of page.Targets || []) {
            // Instances of a registered (tracked) cluster are listed as targets too, but are
            // registered implicitly by the TRACKED_CLUSTER target.
            if (!target.RdsResourceId || !target.Type || (target.Type === 'RDS_INSTANCE' && target.TrackedClusterId)) {
              continue;
            }
            const id = `${proxy}/default/${target.Type}/${target.RdsResourceId}`;
            this.add('aws_db_proxy_target', id, `${proxy}-${target.RdsResourceId}`, {
              db_proxy_name: proxy, target_type: target.Type, identifier: target.RdsResourceId
            });
          }
        }
      }));
    });

    await this.collect('RDS proxy endpoints', async () => {
      for await (const page of paginateDescribeDBProxyEndpoints({ client: rds }, {})) {
        for (const endpoint of page.DBProxyEndpoints || []) {
          // The default endpoint is part of aws_db_proxy.
          if (!endpoint.DBProxyName || !endpoint.DBProxyEndpointName || endpoint.IsDefault || endpoint.Status === 'deleting') {
            continue;
          }
          const id = `${endpoint.DBProxyName}/${endpoint.DBProxyEndpointName}`;
          this.add('aws_db_proxy_endpoint', id, endpoint.DBProxyEndpointName, {
            db_proxy_name: endpoint.DBProxyName,
            db_proxy_endpoint_name: endpoint.DBProxyEndpointName,
            arn: endpoint.DBProxyEndpointArn
          });
        }
      }
    });

    await this.collect('RDS global clusters', async () => {
      for await (const page of paginateDescribeGlobalClusters({ client: rds }, {})) {
        for (const cluster of page.GlobalClusters || []) {
          const id = cluster.GlobalClusterIdentifier;
          if (!id || dbFamily(cluster.Engine) !== 'rds' || cluster.Status === 'deleting'
            || globalClusterHomeRegion(cluster.GlobalClusterMembers) !== this.region) {
            continue;
          }
          this.add('aws_rds_global_cluster', id, id, {
            global_cluster_identifier: id, arn: cluster.GlobalClusterArn, engine: cluster.Engine, tags: tagMap(cluster.TagList)
          });
        }
      }
    });
  }
}

/** Subnet group usages of clusters and instances (instance subnet groups are objects). */
export function dbUses(
  clusters: Array<{ DBSubnetGroup?: string; Engine?: string }>,
  instances: Array<{ DBSubnetGroup?: { DBSubnetGroupName?: string }; Engine?: string }>
): SubnetGroupUse[] {
  return [
    ...clusters.map(cluster => ({ subnetGroup: cluster.DBSubnetGroup, engine: cluster.Engine })),
    ...instances.map(instance => ({ subnetGroup: instance.DBSubnetGroup?.DBSubnetGroupName, engine: instance.Engine }))
  ];
}
