import { KafkaClient, paginateListClustersV2, paginateListConfigurations } from '@aws-sdk/client-kafka';
import { AwsService } from '../aws-service';

/** Amazon MSK provisioned and serverless clusters and MSK configurations. */
export class MSKService extends AwsService {
  async initResources(): Promise<void> {
    const kafka = this.client(KafkaClient);

    await this.collect('MSK clusters', async () => {
      for await (const page of paginateListClustersV2({ client: kafka }, {})) {
        for (const cluster of page.ClusterInfoList || []) {
          // Skip clusters being deleted or whose creation failed.
          if (!cluster.ClusterArn || cluster.State === 'DELETING' || cluster.State === 'FAILED') {
            continue;
          }
          const name = cluster.ClusterName || cluster.ClusterArn;
          const attributes = { cluster_name: name, arn: cluster.ClusterArn, tags: cluster.Tags || {} };
          if (cluster.ClusterType === 'SERVERLESS') {
            this.add('aws_msk_serverless_cluster', cluster.ClusterArn, name, attributes);
          } else {
            this.add('aws_msk_cluster', cluster.ClusterArn, name, attributes);
          }
        }
      }
    });

    await this.collect('MSK configurations', async () => {
      for await (const page of paginateListConfigurations({ client: kafka }, {})) {
        for (const configuration of page.Configurations || []) {
          // Skip configurations being deleted (DELETING / DELETE_FAILED).
          if (!configuration.Arn || configuration.State?.startsWith('DELET')) {
            continue;
          }
          this.add('aws_msk_configuration', configuration.Arn, configuration.Name || configuration.Arn, {
            name: configuration.Name,
            arn: configuration.Arn
          });
        }
      }
    });
  }
}
