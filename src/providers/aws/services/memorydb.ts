import {
  MemoryDBClient,
  paginateDescribeClusters,
  paginateDescribeSubnetGroups,
  paginateDescribeParameterGroups,
  paginateDescribeUsers,
  paginateDescribeACLs
} from '@aws-sdk/client-memorydb';
import { AwsService } from '../aws-service';

export class MemoryDBService extends AwsService {
  async initResources(): Promise<void> {
    const memorydb = this.client(MemoryDBClient);

    await this.collect('MemoryDB clusters', async () => {
      for await (const page of paginateDescribeClusters({ client: memorydb }, {})) {
        for (const cluster of page.Clusters || []) {
          const name = cluster.Name;
          if (!name || cluster.Status === 'deleting') {
            continue;
          }
          this.add('aws_memorydb_cluster', name, name, { name, arn: cluster.ARN, engine: cluster.Engine });
        }
      }
    });

    await this.collect('MemoryDB subnet groups', async () => {
      for await (const page of paginateDescribeSubnetGroups({ client: memorydb }, {})) {
        for (const group of page.SubnetGroups || []) {
          const name = group.Name;
          // `default` is the AWS-created subnet group of the default VPC.
          if (!name || name === 'default') {
            continue;
          }
          this.add('aws_memorydb_subnet_group', name, name, { name, arn: group.ARN, vpc_id: group.VpcId });
        }
      }
    });

    await this.collect('MemoryDB parameter groups', async () => {
      for await (const page of paginateDescribeParameterGroups({ client: memorydb }, {})) {
        for (const group of page.ParameterGroups || []) {
          const name = group.Name;
          // `default.*` groups are AWS-managed.
          if (!name || name.startsWith('default.')) {
            continue;
          }
          this.add('aws_memorydb_parameter_group', name, name, { name, arn: group.ARN, family: group.Family });
        }
      }
    });

    await this.collect('MemoryDB users', async () => {
      for await (const page of paginateDescribeUsers({ client: memorydb }, {})) {
        for (const user of page.Users || []) {
          const name = user.Name;
          // `default` is the built-in user.
          if (!name || name === 'default' || user.Status === 'deleting') {
            continue;
          }
          this.add('aws_memorydb_user', name, name, { user_name: name, arn: user.ARN });
        }
      }
    });

    await this.collect('MemoryDB ACLs', async () => {
      for await (const page of paginateDescribeACLs({ client: memorydb }, {})) {
        for (const acl of page.ACLs || []) {
          const name = acl.Name;
          // `open-access` is the built-in ACL.
          if (!name || name === 'open-access' || acl.Status === 'deleting') {
            continue;
          }
          this.add('aws_memorydb_acl', name, name, { name, arn: acl.ARN });
        }
      }
    });
  }
}
