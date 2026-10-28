import {
  EKSClient,
  paginateListClusters,
  paginateListNodegroups,
  paginateListFargateProfiles,
  paginateListAddons,
  paginateListAccessEntries,
  paginateListAssociatedAccessPolicies,
  paginateListPodIdentityAssociations,
  paginateListIdentityProviderConfigs,
  DescribeClusterCommand,
  DescribeNodegroupCommand,
  DescribeFargateProfileCommand,
  Cluster
} from '@aws-sdk/client-eks';
import { mapLimit } from '../../../core/provider';
import { AwsService, arnResourceName } from '../aws-service';

/** States of objects that are being deleted or failed to be created. */
const GONE_STATES = new Set(['DELETING', 'FAILED', 'CREATE_FAILED', 'DELETE_FAILED']);

export class EKSService extends AwsService {
  private eks!: EKSClient;

  async initResources(): Promise<void> {
    this.eks = this.client(EKSClient);
    const clusters: Cluster[] = [];

    await this.collect('EKS clusters', async () => {
      const names: string[] = [];
      for await (const page of paginateListClusters({ client: this.eks }, {})) {
        names.push(...(page.clusters || []));
      }
      await mapLimit(names, 5, async name => {
        const cluster = (await this.eks.send(new DescribeClusterCommand({ name }))).cluster;
        // Skip clusters being deleted / failed, and external clusters registered through the EKS Connector.
        if (!cluster || GONE_STATES.has(cluster.status || '') || cluster.connectorConfig) {
          return;
        }
        clusters.push(cluster);
        this.add('aws_eks_cluster', name, name, { name, arn: cluster.arn, version: cluster.version, tags: cluster.tags || {} });
      });
    });

    await mapLimit(clusters, 3, cluster => this.loadCluster(cluster));
  }

  private async loadCluster(cluster: Cluster): Promise<void> {
    const clusterName = cluster.name!;
    // Roles EKS creates access entries for automatically (node groups, Fargate profiles, Auto Mode nodes).
    const automaticRoles = new Set<string>();
    if (cluster.computeConfig?.nodeRoleArn) {
      automaticRoles.add(arnResourceName(cluster.computeConfig.nodeRoleArn));
    }

    await this.collect(`EKS node groups of ${clusterName}`, async () => {
      const names: string[] = [];
      for await (const page of paginateListNodegroups({ client: this.eks }, { clusterName })) {
        names.push(...(page.nodegroups || []));
      }
      await mapLimit(names, 5, async nodegroupName => {
        const group = (await this.eks.send(new DescribeNodegroupCommand({ clusterName, nodegroupName }))).nodegroup;
        if (group?.nodeRole) {
          automaticRoles.add(arnResourceName(group.nodeRole));
        }
        if (!group || GONE_STATES.has(group.status || '')) {
          return;
        }
        this.add('aws_eks_node_group', `${clusterName}:${nodegroupName}`, `${clusterName}-${nodegroupName}`, {
          cluster_name: clusterName,
          node_group_name: nodegroupName,
          arn: group.nodegroupArn,
          tags: group.tags || {}
        });
      });
    });

    await this.collect(`EKS Fargate profiles of ${clusterName}`, async () => {
      const names: string[] = [];
      for await (const page of paginateListFargateProfiles({ client: this.eks }, { clusterName })) {
        names.push(...(page.fargateProfileNames || []));
      }
      await mapLimit(names, 5, async fargateProfileName => {
        const profile = (await this.eks.send(new DescribeFargateProfileCommand({ clusterName, fargateProfileName }))).fargateProfile;
        if (profile?.podExecutionRoleArn) {
          automaticRoles.add(arnResourceName(profile.podExecutionRoleArn));
        }
        if (!profile || GONE_STATES.has(profile.status || '')) {
          return;
        }
        this.add('aws_eks_fargate_profile', `${clusterName}:${fargateProfileName}`, `${clusterName}-${fargateProfileName}`, {
          cluster_name: clusterName,
          fargate_profile_name: fargateProfileName,
          arn: profile.fargateProfileArn,
          tags: profile.tags || {}
        });
      });
    });

    await this.collect(`EKS add-ons of ${clusterName}`, async () => {
      for await (const page of paginateListAddons({ client: this.eks }, { clusterName })) {
        for (const addonName of page.addons || []) {
          this.add('aws_eks_addon', `${clusterName}:${addonName}`, `${clusterName}-${addonName}`, {
            cluster_name: clusterName,
            addon_name: addonName
          });
        }
      }
    });

    await this.collect(`EKS identity provider configs of ${clusterName}`, async () => {
      for await (const page of paginateListIdentityProviderConfigs({ client: this.eks }, { clusterName })) {
        for (const config of page.identityProviderConfigs || []) {
          this.add('aws_eks_identity_provider_config', `${clusterName}:${config.name}`, `${clusterName}-${config.name}`, {
            cluster_name: clusterName,
            identity_provider_config_name: config.name
          });
        }
      }
    });

    await this.collect(`EKS pod identity associations of ${clusterName}`, async () => {
      for await (const page of paginateListPodIdentityAssociations({ client: this.eks }, { clusterName })) {
        for (const association of page.associations || []) {
          // Associations with an owner were created by an EKS add-on and are managed through aws_eks_addon.
          if (!association.associationId || association.ownerArn) {
            continue;
          }
          this.add('aws_eks_pod_identity_association', `${clusterName},${association.associationId}`,
            `${clusterName}-${association.namespace}-${association.serviceAccount}`, {
              cluster_name: clusterName,
              association_id: association.associationId,
              namespace: association.namespace,
              service_account: association.serviceAccount,
              arn: association.associationArn
            });
        }
      }
    });

    // Clusters that only use the aws-auth ConfigMap have no access entries (the API rejects the call).
    if (cluster.accessConfig?.authenticationMode === 'CONFIG_MAP') {
      return;
    }
    await this.collect(`EKS access entries of ${clusterName}`, async () => {
      const principals: string[] = [];
      for await (const page of paginateListAccessEntries({ client: this.eks }, { clusterName })) {
        for (const principalArn of page.accessEntries || []) {
          // Skip the entries EKS creates itself for node roles and Fargate pod execution roles.
          if (principalArn.includes(':role/') && automaticRoles.has(arnResourceName(principalArn))) {
            continue;
          }
          principals.push(principalArn);
          this.add('aws_eks_access_entry', `${clusterName}:${principalArn}`, `${clusterName}-${arnResourceName(principalArn)}`, {
            cluster_name: clusterName,
            principal_arn: principalArn
          });
        }
      }
      await mapLimit(principals, 5, async principalArn => {
        for await (const page of paginateListAssociatedAccessPolicies({ client: this.eks }, { clusterName, principalArn })) {
          for (const policy of page.associatedAccessPolicies || []) {
            if (!policy.policyArn) {
              continue;
            }
            this.add('aws_eks_access_policy_association', `${clusterName}#${principalArn}#${policy.policyArn}`,
              `${clusterName}-${arnResourceName(principalArn)}-${arnResourceName(policy.policyArn)}`, {
                cluster_name: clusterName,
                principal_arn: principalArn,
                policy_arn: policy.policyArn
              });
          }
        }
      });
    });
  }
}
