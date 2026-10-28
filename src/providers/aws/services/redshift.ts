import {
  RedshiftClient,
  paginateDescribeClusters,
  paginateDescribeClusterSubnetGroups,
  paginateDescribeClusterParameterGroups
} from '@aws-sdk/client-redshift';
import { AwsService, tagMap } from '../aws-service';

export class RedshiftService extends AwsService {
  async initResources(): Promise<void> {
    const redshift = this.client(RedshiftClient);

    await this.collect('Redshift clusters', async () => {
      for await (const page of paginateDescribeClusters({ client: redshift }, {})) {
        for (const cluster of page.Clusters || []) {
          const id = cluster.ClusterIdentifier;
          if (!id || cluster.ClusterStatus === 'deleting') {
            continue;
          }
          this.add('aws_redshift_cluster', id, id, {
            cluster_identifier: id, tags: tagMap(cluster.Tags)
          });
        }
      }
    });

    await this.collect('Redshift subnet groups', async () => {
      for await (const page of paginateDescribeClusterSubnetGroups({ client: redshift }, {})) {
        for (const group of page.ClusterSubnetGroups || []) {
          const name = group.ClusterSubnetGroupName;
          // `default` is the AWS-created subnet group of the default VPC.
          if (!name || name === 'default') {
            continue;
          }
          this.add('aws_redshift_subnet_group', name, name, { name, vpc_id: group.VpcId, tags: tagMap(group.Tags) });
        }
      }
    });

    await this.collect('Redshift parameter groups', async () => {
      for await (const page of paginateDescribeClusterParameterGroups({ client: redshift }, {})) {
        for (const group of page.ParameterGroups || []) {
          const name = group.ParameterGroupName;
          // `default.*` groups are AWS-managed.
          if (!name || name.startsWith('default.')) {
            continue;
          }
          this.add('aws_redshift_parameter_group', name, name, {
            name, family: group.ParameterGroupFamily, tags: tagMap(group.Tags)
          });
        }
      }
    });
  }
}
