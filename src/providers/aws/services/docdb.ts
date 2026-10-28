import {
  DocDBClient,
  DBCluster,
  DBInstance,
  paginateDescribeDBClusters,
  paginateDescribeDBInstances,
  paginateDescribeDBClusterParameterGroups,
  paginateDescribeDBSubnetGroups,
  paginateDescribeGlobalClusters
} from '@aws-sdk/client-docdb';
import { AwsService } from '../aws-service';
import { dbFamily, dbUses, subnetGroupOwners, globalClusterHomeRegion, SKIPPED_DB_STATUSES } from './rds';

/**
 * Amazon DocumentDB (instance-based clusters). The DocumentDB API returns RDS and Neptune
 * objects too; only objects with engine / parameter group family `docdb*` are imported.
 * Event subscriptions are shared with RDS and imported by the `rds` service.
 */
export class DocDBService extends AwsService {
  async initResources(): Promise<void> {
    const docdb = this.client(DocDBClient);
    const clusters: DBCluster[] = [];
    const instances: DBInstance[] = [];
    let usesComplete = true;

    await this.collect('DocumentDB clusters', async () => {
      try {
        for await (const page of paginateDescribeDBClusters({ client: docdb }, {})) {
          clusters.push(...(page.DBClusters || []));
        }
      } catch (error) {
        usesComplete = false;
        throw error;
      }
      for (const cluster of clusters) {
        const id = cluster.DBClusterIdentifier;
        if (!id || dbFamily(cluster.Engine) !== 'docdb' || SKIPPED_DB_STATUSES.has(cluster.Status || '')) {
          continue;
        }
        this.add('aws_docdb_cluster', id, id, { cluster_identifier: id, arn: cluster.DBClusterArn });
      }
    });

    await this.collect('DocumentDB instances', async () => {
      try {
        for await (const page of paginateDescribeDBInstances({ client: docdb }, {})) {
          instances.push(...(page.DBInstances || []));
        }
      } catch (error) {
        usesComplete = false;
        throw error;
      }
      for (const instance of instances) {
        const id = instance.DBInstanceIdentifier;
        if (!id || dbFamily(instance.Engine) !== 'docdb' || SKIPPED_DB_STATUSES.has(instance.DBInstanceStatus || '')) {
          continue;
        }
        this.add('aws_docdb_cluster_instance', id, id, {
          identifier: id, arn: instance.DBInstanceArn, cluster_identifier: instance.DBClusterIdentifier
        });
      }
    });

    await this.collect('DocumentDB cluster parameter groups', async () => {
      for await (const page of paginateDescribeDBClusterParameterGroups({ client: docdb }, {})) {
        for (const group of page.DBClusterParameterGroups || []) {
          const name = group.DBClusterParameterGroupName;
          // `default.docdb*` groups are AWS-managed.
          if (!name || name.startsWith('default.') || dbFamily(group.DBParameterGroupFamily) !== 'docdb') {
            continue;
          }
          this.add('aws_docdb_cluster_parameter_group', name, name, {
            name, arn: group.DBClusterParameterGroupArn, family: group.DBParameterGroupFamily
          });
        }
      }
    });

    // Subnet groups are shared with RDS/Neptune: only groups used exclusively by DocumentDB
    // are imported here; all others are imported by the `rds` service as aws_db_subnet_group.
    if (usesComplete) {
      await this.collect('DocumentDB subnet groups', async () => {
        const owners = subnetGroupOwners(dbUses(clusters, instances));
        for await (const page of paginateDescribeDBSubnetGroups({ client: docdb }, {})) {
          for (const group of page.DBSubnetGroups || []) {
            const name = group.DBSubnetGroupName;
            if (!name || name === 'default' || owners.get(name) !== 'docdb') {
              continue;
            }
            this.add('aws_docdb_subnet_group', name, name, { name, arn: group.DBSubnetGroupArn, vpc_id: group.VpcId });
          }
        }
      });
    }

    await this.collect('DocumentDB global clusters', async () => {
      for await (const page of paginateDescribeGlobalClusters({ client: docdb }, {})) {
        for (const cluster of page.GlobalClusters || []) {
          const id = cluster.GlobalClusterIdentifier;
          // Listed in every region: imported only in the region of the primary cluster.
          if (!id || dbFamily(cluster.Engine) !== 'docdb' || cluster.Status === 'deleting'
            || globalClusterHomeRegion(cluster.GlobalClusterMembers) !== this.region) {
            continue;
          }
          this.add('aws_docdb_global_cluster', id, id, { global_cluster_identifier: id, arn: cluster.GlobalClusterArn });
        }
      }
    });
  }
}
