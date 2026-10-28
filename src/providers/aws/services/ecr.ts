import {
  ECRClient,
  paginateDescribeRepositories,
  paginateDescribePullThroughCacheRules,
  paginateDescribeRepositoryCreationTemplates,
  DescribeRegistryCommand,
  GetRegistryPolicyCommand,
  GetLifecyclePolicyCommand,
  GetRepositoryPolicyCommand,
  Repository
} from '@aws-sdk/client-ecr';
import { mapLimit } from '../../../core/provider';
import { AwsService, optional } from '../aws-service';

export class ECRService extends AwsService {
  async initResources(): Promise<void> {
    const ecr = this.client(ECRClient);
    const cachePrefixes: string[] = [];

    await this.collect('ECR pull through cache rules', async () => {
      for await (const page of paginateDescribePullThroughCacheRules({ client: ecr }, {})) {
        for (const rule of page.pullThroughCacheRules || []) {
          const prefix = rule.ecrRepositoryPrefix;
          if (prefix) {
            cachePrefixes.push(prefix);
            this.add('aws_ecr_pull_through_cache_rule', prefix, prefix, {
              ecr_repository_prefix: prefix,
              upstream_registry_url: rule.upstreamRegistryUrl
            });
          }
        }
      }
    });

    const repositories: Repository[] = [];
    await this.collect('ECR repositories', async () => {
      for await (const page of paginateDescribeRepositories({ client: ecr }, {})) {
        for (const repository of page.repositories || []) {
          const name = repository.repositoryName;
          // Repositories under a pull through cache prefix are created by ECR on the first pull.
          if (!name || cachePrefixes.some(prefix => name.startsWith(`${prefix}/`))) {
            continue;
          }
          repositories.push(repository);
          this.add('aws_ecr_repository', name, name, { name, arn: repository.repositoryArn, uri: repository.repositoryUri });
        }
      }
    });

    await mapLimit(repositories, 5, repository => this.collect(`ECR policies of ${repository.repositoryName}`, async () => {
      const name = repository.repositoryName!;
      const [lifecycle, policy] = await Promise.all([
        optional(ecr.send(new GetLifecyclePolicyCommand({ repositoryName: name }))),
        optional(ecr.send(new GetRepositoryPolicyCommand({ repositoryName: name })))
      ]);
      if (lifecycle?.lifecyclePolicyText) {
        this.add('aws_ecr_lifecycle_policy', name, name, { repository: name });
      }
      if (policy?.policyText) {
        this.add('aws_ecr_repository_policy', name, name, { repository: name });
      }
    }));

    await this.collect('ECR repository creation templates', async () => {
      for await (const page of paginateDescribeRepositoryCreationTemplates({ client: ecr }, {})) {
        for (const template of page.repositoryCreationTemplates || []) {
          if (template.prefix) {
            this.add('aws_ecr_repository_creation_template', template.prefix, template.prefix, { prefix: template.prefix });
          }
        }
      }
    });

    await this.collect('ECR registry settings', async () => {
      const [registry, registryPolicy] = await Promise.all([
        ecr.send(new DescribeRegistryCommand({})),
        optional(ecr.send(new GetRegistryPolicyCommand({})))
      ]);
      const registryId = registry.registryId || registryPolicy?.registryId;
      if (!registryId) {
        return;
      }
      if (registryPolicy?.policyText) {
        this.add('aws_ecr_registry_policy', registryId, 'registry', { registry_id: registryId });
      }
      // Every registry has a (by default empty) replication configuration; only import a configured one.
      if (registry.replicationConfiguration?.rules?.length) {
        this.add('aws_ecr_replication_configuration', registryId, 'registry', { registry_id: registryId });
      }
    });
  }
}
