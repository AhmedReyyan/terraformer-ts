import { mockClient } from 'aws-sdk-client-mock';
import {
  SageMakerClient,
  ListDomainsCommand,
  ListUserProfilesCommand,
  ListSpacesCommand,
  ListNotebookInstancesCommand,
  ListNotebookInstanceLifecycleConfigsCommand,
  ListModelsCommand,
  ListEndpointConfigsCommand,
  ListEndpointsCommand,
  ListCodeRepositoriesCommand,
  ListModelPackageGroupsCommand,
  ListFeatureGroupsCommand,
  ListPipelinesCommand
} from '@aws-sdk/client-sagemaker';
import { SageMakerService } from '../sagemaker';
import { createService, importIds } from './helpers';

const sagemaker = mockClient(SageMakerClient);
const now = new Date();
const domainArn = 'arn:aws:sagemaker:us-west-2:123456789012:domain/d-abc';

beforeEach(() => {
  sagemaker.reset();
  sagemaker.on(ListDomainsCommand).resolves({ Domains: [] });
  sagemaker.on(ListUserProfilesCommand).resolves({ UserProfiles: [] });
  sagemaker.on(ListSpacesCommand).resolves({ Spaces: [] });
  sagemaker.on(ListNotebookInstancesCommand).resolves({ NotebookInstances: [] });
  sagemaker.on(ListNotebookInstanceLifecycleConfigsCommand).resolves({ NotebookInstanceLifecycleConfigs: [] });
  sagemaker.on(ListModelsCommand).resolves({ Models: [] });
  sagemaker.on(ListEndpointConfigsCommand).resolves({ EndpointConfigs: [] });
  sagemaker.on(ListEndpointsCommand).resolves({ Endpoints: [] });
  sagemaker.on(ListCodeRepositoriesCommand).resolves({ CodeRepositorySummaryList: [] });
  sagemaker.on(ListModelPackageGroupsCommand).resolves({ ModelPackageGroupSummaryList: [] });
  sagemaker.on(ListFeatureGroupsCommand).resolves({ FeatureGroupSummaries: [] });
  sagemaker.on(ListPipelinesCommand).resolves({ PipelineSummaries: [] });
});

describe('SageMakerService', () => {
  it('imports every resource type by its documented ID and skips deleting/failed ones', async () => {
    sagemaker.on(ListDomainsCommand).resolves({
      Domains: [
        { DomainId: 'd-abc', DomainName: 'studio', DomainArn: domainArn, Status: 'InService' },
        { DomainId: 'd-old', DomainArn: 'arn:aws:sagemaker:us-west-2:123456789012:domain/d-old', Status: 'Deleting' }
      ]
    });
    sagemaker.on(ListUserProfilesCommand, { DomainIdEquals: 'd-abc' })
      .resolvesOnce({ UserProfiles: [{ DomainId: 'd-abc', UserProfileName: 'alice', Status: 'InService' }], NextToken: 'p2' })
      .resolvesOnce({
        UserProfiles: [
          { DomainId: 'd-abc', UserProfileName: 'bob', Status: 'InService' },
          { DomainId: 'd-abc', UserProfileName: 'broken', Status: 'Failed' }
        ]
      });
    sagemaker.on(ListSpacesCommand, { DomainIdEquals: 'd-abc' }).resolves({
      Spaces: [{ DomainId: 'd-abc', SpaceName: 'shared', Status: 'InService' }]
    });
    sagemaker.on(ListNotebookInstancesCommand).resolves({
      NotebookInstances: [
        { NotebookInstanceName: 'nb', NotebookInstanceArn: 'arn:nb', NotebookInstanceStatus: 'Stopped' },
        { NotebookInstanceName: 'nb-gone', NotebookInstanceArn: 'arn:nb2', NotebookInstanceStatus: 'Deleting' }
      ]
    });
    sagemaker.on(ListNotebookInstanceLifecycleConfigsCommand).resolves({
      NotebookInstanceLifecycleConfigs: [{ NotebookInstanceLifecycleConfigName: 'lc', NotebookInstanceLifecycleConfigArn: 'arn:lc' }]
    });
    sagemaker.on(ListModelsCommand).resolves({ Models: [{ ModelName: 'model', ModelArn: 'arn:m', CreationTime: now }] });
    sagemaker.on(ListEndpointConfigsCommand).resolves({
      EndpointConfigs: [{ EndpointConfigName: 'cfg', EndpointConfigArn: 'arn:c', CreationTime: now }]
    });
    sagemaker.on(ListEndpointsCommand).resolves({
      Endpoints: [
        { EndpointName: 'ep', EndpointArn: 'arn:e', EndpointStatus: 'InService', CreationTime: now, LastModifiedTime: now },
        { EndpointName: 'ep-bad', EndpointArn: 'arn:e2', EndpointStatus: 'Failed', CreationTime: now, LastModifiedTime: now }
      ]
    });
    sagemaker.on(ListCodeRepositoriesCommand).resolves({
      CodeRepositorySummaryList: [{ CodeRepositoryName: 'repo', CodeRepositoryArn: 'arn:r', CreationTime: now, LastModifiedTime: now }]
    });
    sagemaker.on(ListModelPackageGroupsCommand).resolves({
      ModelPackageGroupSummaryList: [
        { ModelPackageGroupName: 'mpg', ModelPackageGroupArn: 'arn:g', CreationTime: now, ModelPackageGroupStatus: 'Completed' },
        { ModelPackageGroupName: 'mpg-del', ModelPackageGroupArn: 'arn:g2', CreationTime: now, ModelPackageGroupStatus: 'DeleteFailed' }
      ]
    });
    sagemaker.on(ListFeatureGroupsCommand).resolves({
      FeatureGroupSummaries: [
        { FeatureGroupName: 'fg', FeatureGroupArn: 'arn:f', CreationTime: now, FeatureGroupStatus: 'Created' },
        { FeatureGroupName: 'fg-bad', FeatureGroupArn: 'arn:f2', CreationTime: now, FeatureGroupStatus: 'CreateFailed' }
      ]
    });
    sagemaker.on(ListPipelinesCommand).resolves({ PipelineSummaries: [{ PipelineName: 'train' }] });

    const service = createService(SageMakerService, 'sagemaker', 'us-west-2');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_sagemaker_code_repository:repo',
      'aws_sagemaker_domain:d-abc',
      'aws_sagemaker_endpoint:ep',
      'aws_sagemaker_endpoint_configuration:cfg',
      'aws_sagemaker_feature_group:fg',
      'aws_sagemaker_model:model',
      'aws_sagemaker_model_package_group:mpg',
      'aws_sagemaker_notebook_instance:nb',
      'aws_sagemaker_notebook_instance_lifecycle_configuration:lc',
      'aws_sagemaker_pipeline:train',
      'aws_sagemaker_space:arn:aws:sagemaker:us-west-2:123456789012:space/d-abc/shared',
      'aws_sagemaker_user_profile:arn:aws:sagemaker:us-west-2:123456789012:user-profile/d-abc/alice',
      'aws_sagemaker_user_profile:arn:aws:sagemaker:us-west-2:123456789012:user-profile/d-abc/bob'
    ]);
    // Children of the skipped (deleting) domain are not listed.
    expect(sagemaker.commandCalls(ListUserProfilesCommand).map(c => c.args[0].input.DomainIdEquals)).toEqual(['d-abc', 'd-abc']);
    expect(sagemaker.commandCalls(ListUserProfilesCommand)[1].args[0].input).toMatchObject({ NextToken: 'p2' });
    expect(service.getWarnings()).toEqual([]);
  });
});
