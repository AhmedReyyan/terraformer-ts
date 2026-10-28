import {
  EMRClient,
  paginateListClusters,
  paginateListSecurityConfigurations,
  paginateListStudios,
  paginateListInstanceGroups,
  GetManagedScalingPolicyCommand,
  ClusterState,
  ClusterSummary
} from '@aws-sdk/client-emr';
import { mapLimit } from '../../../core/provider';
import { AwsService } from '../aws-service';

/** Only clusters that are still alive; terminated clusters stay listed for two months. */
const ACTIVE_STATES: ClusterState[] = ['STARTING', 'BOOTSTRAPPING', 'RUNNING', 'WAITING'];

/** Instance group states of groups that are gone or going away. */
const ENDED_GROUP_STATES = new Set(['ENDED', 'SHUTTING_DOWN', 'TERMINATING', 'TERMINATED', 'ARRESTED']);

export class EMRService extends AwsService {
  async initResources(): Promise<void> {
    const emr = this.client(EMRClient);
    const clusters: ClusterSummary[] = [];

    await this.collect('EMR clusters', async () => {
      for await (const page of paginateListClusters({ client: emr }, { ClusterStates: ACTIVE_STATES })) {
        for (const cluster of page.Clusters || []) {
          if (cluster.Id) {
            clusters.push(cluster);
            this.add('aws_emr_cluster', cluster.Id, cluster.Name || cluster.Id, {
              id: cluster.Id,
              name: cluster.Name,
              arn: cluster.ClusterArn
            });
          }
        }
      }
    });

    await mapLimit(clusters, 5, cluster => this.collect(`EMR configuration of ${cluster.Id}`, async () => {
      const clusterId = cluster.Id!;
      const name = cluster.Name || clusterId;
      const scaling = await emr.send(new GetManagedScalingPolicyCommand({ ClusterId: clusterId }));
      if (scaling.ManagedScalingPolicy?.ComputeLimits) {
        this.add('aws_emr_managed_scaling_policy', clusterId, name, { cluster_id: clusterId });
      }
      try {
        for await (const page of paginateListInstanceGroups({ client: emr }, { ClusterId: clusterId })) {
          for (const group of page.InstanceGroups || []) {
            // Master and core groups are configured inside aws_emr_cluster; only task groups are separate resources.
            if (!group.Id || group.InstanceGroupType !== 'TASK' || ENDED_GROUP_STATES.has(group.Status?.State || '')) {
              continue;
            }
            this.add('aws_emr_instance_group', `${clusterId}/${group.Id}`, `${name}-${group.Name || group.Id}`, {
              cluster_id: clusterId,
              id: group.Id,
              name: group.Name
            });
          }
        }
      } catch (error) {
        // Clusters that use instance fleets have no instance groups and reject the call.
        if ((error as { name?: string })?.name !== 'InvalidRequestException') {
          throw error;
        }
      }
    }));

    await this.collect('EMR security configurations', async () => {
      for await (const page of paginateListSecurityConfigurations({ client: emr }, {})) {
        for (const config of page.SecurityConfigurations || []) {
          if (config.Name) {
            this.add('aws_emr_security_configuration', config.Name, config.Name, { name: config.Name });
          }
        }
      }
    });

    await this.collect('EMR studios', async () => {
      for await (const page of paginateListStudios({ client: emr }, {})) {
        for (const studio of page.Studios || []) {
          if (studio.StudioId) {
            this.add('aws_emr_studio', studio.StudioId, studio.Name || studio.StudioId, { id: studio.StudioId, name: studio.Name });
          }
        }
      }
    });
  }
}
