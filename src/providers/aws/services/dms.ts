import {
  DatabaseMigrationServiceClient,
  paginateDescribeReplicationInstances,
  paginateDescribeEndpoints,
  paginateDescribeReplicationTasks,
  paginateDescribeReplicationSubnetGroups
} from '@aws-sdk/client-database-migration-service';
import { AwsService } from '../aws-service';

const isDeleting = (status?: string) => status === 'deleting' || status === 'deleted';

/** AWS DMS replication instances, endpoints, replication tasks and subnet groups. */
export class DMSService extends AwsService {
  async initResources(): Promise<void> {
    const dms = this.client(DatabaseMigrationServiceClient);

    await this.collect('DMS replication instances', async () => {
      for await (const page of paginateDescribeReplicationInstances({ client: dms }, {})) {
        for (const instance of page.ReplicationInstances || []) {
          const id = instance.ReplicationInstanceIdentifier;
          if (id && !isDeleting(instance.ReplicationInstanceStatus)) {
            this.add('aws_dms_replication_instance', id, id, { id, arn: instance.ReplicationInstanceArn });
          }
        }
      }
    });

    await this.collect('DMS endpoints', async () => {
      for await (const page of paginateDescribeEndpoints({ client: dms }, {})) {
        for (const endpoint of page.Endpoints || []) {
          const id = endpoint.EndpointIdentifier;
          if (!id || isDeleting(endpoint.Status)) {
            continue;
          }
          const attributes = { id, arn: endpoint.EndpointArn, engine_name: endpoint.EngineName, endpoint_type: endpoint.EndpointType };
          // aws_dms_endpoint has no S3 settings in provider v6; S3 endpoints use aws_dms_s3_endpoint.
          if (endpoint.EngineName === 's3') {
            this.add('aws_dms_s3_endpoint', id, id, attributes);
          } else {
            this.add('aws_dms_endpoint', id, id, attributes);
          }
        }
      }
    });

    await this.collect('DMS replication tasks', async () => {
      for await (const page of paginateDescribeReplicationTasks({ client: dms }, { WithoutSettings: true })) {
        for (const task of page.ReplicationTasks || []) {
          const id = task.ReplicationTaskIdentifier;
          if (id && !isDeleting(task.Status)) {
            this.add('aws_dms_replication_task', id, id, { id, arn: task.ReplicationTaskArn });
          }
        }
      }
    });

    await this.collect('DMS replication subnet groups', async () => {
      for await (const page of paginateDescribeReplicationSubnetGroups({ client: dms }, {})) {
        for (const group of page.ReplicationSubnetGroups || []) {
          const id = group.ReplicationSubnetGroupIdentifier;
          // Skip the subnet groups DMS creates automatically (`default`, `default-vpc-xxxx`).
          if (!id || id === 'default' || id.startsWith('default-vpc-')) {
            continue;
          }
          this.add('aws_dms_replication_subnet_group', id, id, { id, vpc_id: group.VpcId });
        }
      }
    });
  }
}
