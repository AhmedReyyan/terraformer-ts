import {
  NeptuneClient,
  DBCluster,
  DBInstance,
  paginateDescribeDBClusters,
  paginateDescribeDBInstances,
  paginateDescribeDBClusterEndpoints,
  paginateDescribeDBClusterParameterGroups,
  paginateDescribeDBParameterGroups,
  paginateDescribeDBSubnetGroups,
  paginateDescribeGlobalClusters
} from '@aws-sdk/client-neptune';
import { AwsService } from '../aws-service';
import { dbFamily, dbUses, subnetGroupOwners, globalClusterHomeRegion, SKIPPED_DB_STATUSES } from './rds';

/**
 * Amazon Neptune. The Neptune API returns RDS and DocumentDB objects too; only objects
 * with engine / parameter group family `neptune*` are imported. Event subscriptions are
 * shared with RDS and imported by the `rds` service.
 */
export class NeptuneService extends AwsService {
  async initResources(): Promise<void> {
    const neptune = this.client(NeptuneClient);
    const clusters: DBCluster[] = [];
    const instances: DBInstance[] = [];
    let usesComplete = true;

    await this.collect('Neptune clusters', async () => {
      try {
        for await (const page of paginateDescribeDBClusters({ client: neptune }, {})) {
          clusters.push(...(page.DBClusters || []));
        }
      } catch (error) {
        usesComplete = false;
        throw error;
      }
      for (const cluster of clusters) {
        const id = cluster.DBClusterIdentifier;
        if (!id || dbFamily(cluster.Engine) !== 'neptune' || SKIPPED_DB_STATUSES.has(cluster.Status || '')) {
          continue;
        }
        this.add('aws_neptune_cluster', id, id, { cluster_identifier: id, arn: cluster.DBClusterArn });
      }
    });

    await this.collect('Neptune cluster endpoints', async () => {
      const neptuneClusters = new Set(clusters.filter(c => dbFamily(c.Engine) === 'neptune').map(c => c.DBClusterIdentifier));
      for await (const page of paginateDescribeDBClusterEndpoints({ client: neptune }, {})) {
        for (const endpoint of page.DBClusterEndpoints || []) {
          const id = endpoint.DBClusterEndpointIdentifier;
          // Only custom endpoints are separate objects; the writer/reader endpoints belong to the cluster.
          if (!id || endpoint.EndpointType !== 'CUSTOM' || !neptuneClusters.has(endpoint.DBClusterIdentifier)
            || endpoint.Status === 'deleting') {
            continue;
          }
          this.add('aws_neptune_cluster_endpoint', `${endpoint.DBClusterIdentifier}:${id}`, id, {
            cluster_endpoint_identifier: id, cluster_identifier: endpoint.DBClusterIdentifier, arn: endpoint.DBClusterEndpointArn
          });
        }
      }
    });

    await this.collect('Neptune instances', async () => {
      try {
        for await (const page of paginateDescribeDBInstances({ client: neptune }, {})) {
          instances.push(...(page.DBInstances || []));
        }
      } catch (error) {
        usesComplete = false;
        throw error;
      }
      for (const instance of instances) {
        const id = instance.DBInstanceIdentifier;
        if (!id || dbFamily(instance.Engine) !== 'neptune' || SKIPPED_DB_STATUSES.has(instance.DBInstanceStatus || '')) {
          continue;
        }
        this.add('aws_neptune_cluster_instance', id, id, {
          identifier: id, arn: instance.DBInstanceArn, cluster_identifier: instance.DBClusterIdentifier
        });
      }
    });

    await this.collect('Neptune cluster parameter groups', async () => {
      for await (const page of paginateDescribeDBClusterParameterGroups({ client: neptune }, {})) {
        for (const group of page.DBClusterParameterGroups || []) {
          const name = group.DBClusterParameterGroupName;
          // `default.neptune*` groups are AWS-managed.
          if (!name || name.startsWith('default.') || dbFamily(group.DBParameterGroupFamily) !== 'neptune') {
            continue;
          }
          this.add('aws_neptune_cluster_parameter_group', name, name, {
            name, arn: group.DBClusterParameterGroupArn, family: group.DBParameterGroupFamily
          });
        }
      }
    });

    await this.collect('Neptune parameter groups', async () => {
      for await (const page of paginateDescribeDBParameterGroups({ client: neptune }, {})) {
        for (const group of page.DBParameterGroups || []) {
          const name = group.DBParameterGroupName;
          if (!name || name.startsWith('default.') || dbFamily(group.DBParameterGroupFamily) !== 'neptune') {
            continue;
          }
          this.add('aws_neptune_parameter_group', name, name, {
            name, arn: group.DBParameterGroupArn, family: group.DBParameterGroupFamily
          });
        }
      }
    });

    // Subnet groups are shared with RDS/DocumentDB: only groups used exclusively by Neptune
    // are imported here; all others are imported by the `rds` service as aws_db_subnet_group.
    if (usesComplete) {
      await this.collect('Neptune subnet groups', async () => {
        const owners = subnetGroupOwners(dbUses(clusters, instances));
        for await (const page of paginateDescribeDBSubnetGroups({ client: neptune }, {})) {
          for (const group of page.DBSubnetGroups || []) {
            const name = group.DBSubnetGroupName;
            if (!name || name === 'default' || owners.get(name) !== 'neptune') {
              continue;
            }
            this.add('aws_neptune_subnet_group', name, name, { name, arn: group.DBSubnetGroupArn, vpc_id: group.VpcId });
          }
        }
      });
    }

    await this.collect('Neptune global clusters', async () => {
      for await (const page of paginateDescribeGlobalClusters({ client: neptune }, {})) {
        for (const cluster of page.GlobalClusters || []) {
          const id = cluster.GlobalClusterIdentifier;
          // Listed in every region: imported only in the region of the primary cluster.
          if (!id || dbFamily(cluster.Engine) !== 'neptune' || cluster.Status === 'deleting'
            || globalClusterHomeRegion(cluster.GlobalClusterMembers) !== this.region) {
            continue;
          }
          this.add('aws_neptune_global_cluster', id, id, { global_cluster_identifier: id, arn: cluster.GlobalClusterArn });
        }
      }
    });
  }
}
