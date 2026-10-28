import {
  SageMakerClient,
  DomainDetails,
  paginateListDomains,
  paginateListUserProfiles,
  paginateListSpaces,
  paginateListNotebookInstances,
  paginateListNotebookInstanceLifecycleConfigs,
  paginateListModels,
  paginateListEndpointConfigs,
  paginateListEndpoints,
  paginateListCodeRepositories,
  paginateListModelPackageGroups,
  paginateListFeatureGroups,
  paginateListPipelines
} from '@aws-sdk/client-sagemaker';
import { AwsService } from '../aws-service';
import { mapLimit } from '../../../core/provider';

// Objects being deleted or whose creation/deletion failed are skipped.
const SKIPPED_STATES = new Set([
  'Deleting', 'Failed', 'Delete_Failed', 'DeleteFailed', 'CreateFailed'
]);

const skipped = (status?: string) => SKIPPED_STATES.has(status || '');

export class SageMakerService extends AwsService {
  async initResources(): Promise<void> {
    const sagemaker = this.client(SageMakerClient);
    const domains: DomainDetails[] = [];

    await this.collect('SageMaker domains', async () => {
      for await (const page of paginateListDomains({ client: sagemaker }, {})) {
        for (const domain of page.Domains || []) {
          if (domain.DomainId && domain.DomainArn && !skipped(domain.Status)) {
            domains.push(domain);
            this.add('aws_sagemaker_domain', domain.DomainId, domain.DomainName || domain.DomainId, {
              id: domain.DomainId, name: domain.DomainName, arn: domain.DomainArn
            });
          }
        }
      }
    });

    await mapLimit(domains, 5, async domain => {
      const domainId = domain.DomainId as string;
      // User profile and space import IDs are ARNs: arn:<partition>:sagemaker:<region>:<account>:<kind>/<domain-id>/<name>.
      const childArn = (kind: string, name: string) =>
        domain.DomainArn!.replace(/:domain\/.*$/, `:${kind}/${domainId}/${name}`);

      await this.collect(`SageMaker user profiles of ${domainId}`, async () => {
        for await (const page of paginateListUserProfiles({ client: sagemaker }, { DomainIdEquals: domainId })) {
          for (const profile of page.UserProfiles || []) {
            if (profile.UserProfileName && !skipped(profile.Status)) {
              const arn = childArn('user-profile', profile.UserProfileName);
              this.add('aws_sagemaker_user_profile', arn, `${domain.DomainName || domainId}-${profile.UserProfileName}`, {
                name: profile.UserProfileName, domain_id: domainId, arn
              });
            }
          }
        }
      });

      await this.collect(`SageMaker spaces of ${domainId}`, async () => {
        for await (const page of paginateListSpaces({ client: sagemaker }, { DomainIdEquals: domainId })) {
          for (const space of page.Spaces || []) {
            if (space.SpaceName && !skipped(space.Status)) {
              const arn = childArn('space', space.SpaceName);
              this.add('aws_sagemaker_space', arn, `${domain.DomainName || domainId}-${space.SpaceName}`, {
                name: space.SpaceName, domain_id: domainId, arn
              });
            }
          }
        }
      });
    });

    await this.collect('SageMaker notebook instances', async () => {
      for await (const page of paginateListNotebookInstances({ client: sagemaker }, {})) {
        for (const notebook of page.NotebookInstances || []) {
          if (notebook.NotebookInstanceName && !skipped(notebook.NotebookInstanceStatus)) {
            this.add('aws_sagemaker_notebook_instance', notebook.NotebookInstanceName, notebook.NotebookInstanceName, {
              name: notebook.NotebookInstanceName, arn: notebook.NotebookInstanceArn
            });
          }
        }
      }
    });

    await this.collect('SageMaker notebook lifecycle configurations', async () => {
      for await (const page of paginateListNotebookInstanceLifecycleConfigs({ client: sagemaker }, {})) {
        for (const config of page.NotebookInstanceLifecycleConfigs || []) {
          const name = config.NotebookInstanceLifecycleConfigName;
          if (name) {
            this.add('aws_sagemaker_notebook_instance_lifecycle_configuration', name, name, {
              name, arn: config.NotebookInstanceLifecycleConfigArn
            });
          }
        }
      }
    });

    await this.collect('SageMaker models', async () => {
      for await (const page of paginateListModels({ client: sagemaker }, {})) {
        for (const model of page.Models || []) {
          if (model.ModelName) {
            this.add('aws_sagemaker_model', model.ModelName, model.ModelName, { name: model.ModelName, arn: model.ModelArn });
          }
        }
      }
    });

    await this.collect('SageMaker endpoint configurations', async () => {
      for await (const page of paginateListEndpointConfigs({ client: sagemaker }, {})) {
        for (const config of page.EndpointConfigs || []) {
          if (config.EndpointConfigName) {
            this.add('aws_sagemaker_endpoint_configuration', config.EndpointConfigName, config.EndpointConfigName, {
              name: config.EndpointConfigName, arn: config.EndpointConfigArn
            });
          }
        }
      }
    });

    await this.collect('SageMaker endpoints', async () => {
      for await (const page of paginateListEndpoints({ client: sagemaker }, {})) {
        for (const endpoint of page.Endpoints || []) {
          if (endpoint.EndpointName && !skipped(endpoint.EndpointStatus)) {
            this.add('aws_sagemaker_endpoint', endpoint.EndpointName, endpoint.EndpointName, {
              name: endpoint.EndpointName, arn: endpoint.EndpointArn
            });
          }
        }
      }
    });

    await this.collect('SageMaker code repositories', async () => {
      for await (const page of paginateListCodeRepositories({ client: sagemaker }, {})) {
        for (const repo of page.CodeRepositorySummaryList || []) {
          if (repo.CodeRepositoryName) {
            this.add('aws_sagemaker_code_repository', repo.CodeRepositoryName, repo.CodeRepositoryName, {
              name: repo.CodeRepositoryName, arn: repo.CodeRepositoryArn
            });
          }
        }
      }
    });

    await this.collect('SageMaker model package groups', async () => {
      for await (const page of paginateListModelPackageGroups({ client: sagemaker }, {})) {
        for (const group of page.ModelPackageGroupSummaryList || []) {
          if (group.ModelPackageGroupName && !skipped(group.ModelPackageGroupStatus)) {
            this.add('aws_sagemaker_model_package_group', group.ModelPackageGroupName, group.ModelPackageGroupName, {
              name: group.ModelPackageGroupName, arn: group.ModelPackageGroupArn
            });
          }
        }
      }
    });

    await this.collect('SageMaker feature groups', async () => {
      for await (const page of paginateListFeatureGroups({ client: sagemaker }, {})) {
        for (const group of page.FeatureGroupSummaries || []) {
          if (group.FeatureGroupName && !skipped(group.FeatureGroupStatus)) {
            this.add('aws_sagemaker_feature_group', group.FeatureGroupName, group.FeatureGroupName, {
              name: group.FeatureGroupName, arn: group.FeatureGroupArn
            });
          }
        }
      }
    });

    await this.collect('SageMaker pipelines', async () => {
      for await (const page of paginateListPipelines({ client: sagemaker }, {})) {
        for (const pipeline of page.PipelineSummaries || []) {
          if (pipeline.PipelineName) {
            this.add('aws_sagemaker_pipeline', pipeline.PipelineName, pipeline.PipelineName, {
              name: pipeline.PipelineName, arn: pipeline.PipelineArn
            });
          }
        }
      }
    });
  }
}
