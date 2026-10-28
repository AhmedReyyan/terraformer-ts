import { ECRPUBLICClient, paginateDescribeRepositories, GetRepositoryPolicyCommand, Repository } from '@aws-sdk/client-ecr-public';
import { mapLimit } from '../../../core/provider';
import { AwsService, optional } from '../aws-service';

/** The ECR Public API is only available in us-east-1. */
const ECR_PUBLIC_REGION = 'us-east-1';

export class ECRPublicService extends AwsService {
  async initResources(): Promise<void> {
    // Public repositories are only reachable through us-east-1; other regions have nothing to import.
    if (this.region !== ECR_PUBLIC_REGION) {
      return;
    }
    const ecr = this.client(ECRPUBLICClient);
    const repositories: Repository[] = [];

    await this.collect('ECR Public repositories', async () => {
      for await (const page of paginateDescribeRepositories({ client: ecr }, {})) {
        for (const repository of page.repositories || []) {
          const name = repository.repositoryName;
          if (name) {
            repositories.push(repository);
            this.add('aws_ecrpublic_repository', name, name, {
              repository_name: name,
              arn: repository.repositoryArn,
              uri: repository.repositoryUri
            });
          }
        }
      }
    });

    await mapLimit(repositories, 5, repository => this.collect(`ECR Public policy of ${repository.repositoryName}`, async () => {
      const name = repository.repositoryName!;
      const policy = await optional(ecr.send(new GetRepositoryPolicyCommand({ repositoryName: name })));
      if (policy?.policyText) {
        this.add('aws_ecrpublic_repository_policy', name, name, { repository_name: name });
      }
    }));
  }
}
