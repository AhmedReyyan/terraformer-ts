import { mockClient } from 'aws-sdk-client-mock';
import {
  EKSClient,
  ListClustersCommand,
  DescribeClusterCommand,
  ListNodegroupsCommand,
  DescribeNodegroupCommand,
  ListFargateProfilesCommand,
  DescribeFargateProfileCommand,
  ListAddonsCommand,
  ListAccessEntriesCommand,
  ListAssociatedAccessPoliciesCommand,
  ListPodIdentityAssociationsCommand,
  ListIdentityProviderConfigsCommand
} from '@aws-sdk/client-eks';
import { EKSService } from '../eks';
import { createService, importIds } from './helpers';

const eks = mockClient(EKSClient);
const role = (name: string) => `arn:aws:iam::123456789012:role/${name}`;
const VIEW = 'arn:aws:eks::aws:cluster-access-policy/AmazonEKSViewPolicy';

beforeEach(() => {
  eks.reset();
  eks.on(ListNodegroupsCommand).resolves({ nodegroups: [] });
  eks.on(ListFargateProfilesCommand).resolves({ fargateProfileNames: [] });
  eks.on(ListAddonsCommand).resolves({ addons: [] });
  eks.on(ListAccessEntriesCommand).resolves({ accessEntries: [] });
  eks.on(ListAssociatedAccessPoliciesCommand).resolves({ associatedAccessPolicies: [] });
  eks.on(ListPodIdentityAssociationsCommand).resolves({ associations: [] });
  eks.on(ListIdentityProviderConfigsCommand).resolves({ identityProviderConfigs: [] });
});

describe('EKSService', () => {
  it('imports clusters with their node groups, profiles, add-ons and access configuration', async () => {
    eks.on(ListClustersCommand).resolvesOnce({ clusters: ['prod'], nextToken: 'n1' }).resolvesOnce({ clusters: ['dying', 'external'] });
    eks.on(DescribeClusterCommand, { name: 'prod' }).resolves({
      cluster: { name: 'prod', status: 'ACTIVE', accessConfig: { authenticationMode: 'API_AND_CONFIG_MAP' }, tags: { team: 'core' } }
    });
    eks.on(DescribeClusterCommand, { name: 'dying' }).resolves({ cluster: { name: 'dying', status: 'DELETING' } });
    eks.on(DescribeClusterCommand, { name: 'external' }).resolves({
      cluster: { name: 'external', status: 'ACTIVE', connectorConfig: { provider: 'OTHER' } }
    });
    eks.on(ListNodegroupsCommand, { clusterName: 'prod' }).resolves({ nodegroups: ['general', 'broken'] });
    eks.on(DescribeNodegroupCommand, { nodegroupName: 'general' }).resolves({
      nodegroup: { nodegroupName: 'general', status: 'ACTIVE', nodeRole: role('node-role') }
    });
    eks.on(DescribeNodegroupCommand, { nodegroupName: 'broken' }).resolves({
      nodegroup: { nodegroupName: 'broken', status: 'CREATE_FAILED', nodeRole: role('node-role') }
    });
    eks.on(ListFargateProfilesCommand, { clusterName: 'prod' }).resolves({ fargateProfileNames: ['fp'] });
    eks.on(DescribeFargateProfileCommand).resolves({
      fargateProfile: { fargateProfileName: 'fp', status: 'ACTIVE', podExecutionRoleArn: role('path/fargate-role') }
    });
    eks.on(ListAddonsCommand, { clusterName: 'prod' }).resolves({ addons: ['vpc-cni'] });
    eks.on(ListIdentityProviderConfigsCommand, { clusterName: 'prod' }).resolves({
      identityProviderConfigs: [{ type: 'oidc', name: 'okta' }]
    });
    eks.on(ListPodIdentityAssociationsCommand, { clusterName: 'prod' }).resolves({
      associations: [
        { associationId: 'a-123', namespace: 'default', serviceAccount: 'app' },
        { associationId: 'a-addon', namespace: 'kube-system', serviceAccount: 'aws-node', ownerArn: 'arn:addon' }
      ]
    });
    eks.on(ListAccessEntriesCommand, { clusterName: 'prod' })
      .resolvesOnce({ accessEntries: [role('admin'), role('node-role')], nextToken: 'a1' })
      .resolvesOnce({ accessEntries: [role('fargate-role')] });
    eks.on(ListAssociatedAccessPoliciesCommand, { principalArn: role('admin') }).resolves({
      associatedAccessPolicies: [{ policyArn: VIEW }]
    });

    const service = createService(EKSService, 'eks');
    await service.initResources();

    expect(importIds(service)).toEqual([
      `aws_eks_access_entry:prod:${role('admin')}`,
      `aws_eks_access_policy_association:prod#${role('admin')}#${VIEW}`,
      'aws_eks_addon:prod:vpc-cni',
      'aws_eks_cluster:prod',
      'aws_eks_fargate_profile:prod:fp',
      'aws_eks_identity_provider_config:prod:okta',
      'aws_eks_node_group:prod:general',
      'aws_eks_pod_identity_association:prod,a-123'
    ]);
    expect(service.getWarnings()).toEqual([]);
  });

  it('does not list access entries of clusters that only use the aws-auth ConfigMap', async () => {
    eks.on(ListClustersCommand).resolves({ clusters: ['legacy'] });
    eks.on(DescribeClusterCommand).resolves({
      cluster: { name: 'legacy', status: 'ACTIVE', accessConfig: { authenticationMode: 'CONFIG_MAP' } }
    });

    const service = createService(EKSService, 'eks');
    await service.initResources();

    expect(importIds(service)).toEqual(['aws_eks_cluster:legacy']);
    expect(eks.commandCalls(ListAccessEntriesCommand)).toHaveLength(0);
  });
});
