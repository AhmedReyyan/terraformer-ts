import { mockClient } from 'aws-sdk-client-mock';
import {
  ECRClient,
  DescribeRepositoriesCommand,
  DescribePullThroughCacheRulesCommand,
  DescribeRepositoryCreationTemplatesCommand,
  DescribeRegistryCommand,
  GetRegistryPolicyCommand,
  GetLifecyclePolicyCommand,
  GetRepositoryPolicyCommand
} from '@aws-sdk/client-ecr';
import { ECRService } from '../ecr';
import { createService, importIds, notFound } from './helpers';

const ecr = mockClient(ECRClient);

beforeEach(() => {
  ecr.reset();
  ecr.on(DescribePullThroughCacheRulesCommand).resolves({ pullThroughCacheRules: [] });
  ecr.on(DescribeRepositoryCreationTemplatesCommand).resolves({ repositoryCreationTemplates: [] });
  ecr.on(DescribeRegistryCommand).resolves({ registryId: '123456789012', replicationConfiguration: { rules: [] } });
  ecr.on(GetRegistryPolicyCommand).rejects(notFound('RegistryPolicyNotFoundException'));
  ecr.on(GetLifecyclePolicyCommand).rejects(notFound('LifecyclePolicyNotFoundException'));
  ecr.on(GetRepositoryPolicyCommand).rejects(notFound('RepositoryPolicyNotFoundException'));
});

describe('ECRService', () => {
  it('imports repositories and only the policies that exist', async () => {
    ecr.on(DescribeRepositoriesCommand)
      .resolvesOnce({ repositories: [{ repositoryName: 'api' }], nextToken: 'n1' })
      .resolvesOnce({ repositories: [{ repositoryName: 'worker' }, { repositoryName: 'ecr-public/nginx/nginx' }] });
    ecr.on(DescribePullThroughCacheRulesCommand).resolves({
      pullThroughCacheRules: [{ ecrRepositoryPrefix: 'ecr-public', upstreamRegistryUrl: 'public.ecr.aws' }]
    });
    ecr.on(GetLifecyclePolicyCommand, { repositoryName: 'api' }).resolves({ lifecyclePolicyText: '{}' });
    ecr.on(GetRepositoryPolicyCommand, { repositoryName: 'worker' }).resolves({ policyText: '{}' });
    ecr.on(DescribeRepositoryCreationTemplatesCommand).resolves({ repositoryCreationTemplates: [{ prefix: 'ROOT' }] });
    ecr.on(DescribeRegistryCommand).resolves({
      registryId: '123456789012',
      replicationConfiguration: { rules: [{ destinations: [{ region: 'eu-west-1', registryId: '123456789012' }] }] }
    });
    ecr.on(GetRegistryPolicyCommand).resolves({ registryId: '123456789012', policyText: '{}' });

    const service = createService(ECRService, 'ecr');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_ecr_lifecycle_policy:api',
      'aws_ecr_pull_through_cache_rule:ecr-public',
      'aws_ecr_registry_policy:123456789012',
      'aws_ecr_replication_configuration:123456789012',
      'aws_ecr_repository:api',
      'aws_ecr_repository:worker',
      'aws_ecr_repository_creation_template:ROOT',
      'aws_ecr_repository_policy:worker'
    ]);
    expect(service.getWarnings()).toEqual([]);
  });

  it('skips the empty default replication configuration and missing registry policy', async () => {
    ecr.on(DescribeRepositoriesCommand).resolves({ repositories: [] });

    const service = createService(ECRService, 'ecr');
    await service.initResources();

    expect(importIds(service)).toEqual([]);
    expect(service.getWarnings()).toEqual([]);
  });
});
