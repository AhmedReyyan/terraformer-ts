import { mockClient } from 'aws-sdk-client-mock';
import {
  CodePipelineClient,
  ListPipelinesCommand,
  ListWebhooksCommand,
  ListActionTypesCommand
} from '@aws-sdk/client-codepipeline';
import { CodePipelineService } from '../codepipeline';
import { createService, importIds } from './helpers';

const codepipeline = mockClient(CodePipelineClient);

beforeEach(() => {
  codepipeline.reset();
  codepipeline.on(ListPipelinesCommand).resolves({});
  codepipeline.on(ListWebhooksCommand).resolves({});
  codepipeline.on(ListActionTypesCommand).resolves({ actionTypes: [] });
});

describe('CodePipelineService', () => {
  it('imports pipelines, webhooks and custom action types', async () => {
    codepipeline.on(ListPipelinesCommand).resolvesOnce({ pipelines: [{ name: 'deploy', pipelineType: 'V2' }], nextToken: 'p2' })
      .resolvesOnce({ pipelines: [{ name: 'release' }] });
    codepipeline.on(ListWebhooksCommand).resolves({
      webhooks: [{
        arn: 'arn:aws:codepipeline:us-east-1:1:webhook:gh',
        url: 'https://hook',
        definition: {
          name: 'gh', targetPipeline: 'deploy', targetAction: 'Source', filters: [], authentication: 'GITHUB_HMAC',
          authenticationConfiguration: { SecretToken: 'super-secret' }
        },
        tags: [{ key: 'team', value: 'core' }]
      }]
    });
    codepipeline.on(ListActionTypesCommand).resolves({
      actionTypes: [
        { id: { category: 'Build', owner: 'Custom', provider: 'terraform', version: '1' }, inputArtifactDetails: { minimumCount: 0, maximumCount: 1 }, outputArtifactDetails: { minimumCount: 0, maximumCount: 1 } },
        { id: { category: 'Deploy', owner: 'AWS', provider: 'S3', version: '1' }, inputArtifactDetails: { minimumCount: 0, maximumCount: 1 }, outputArtifactDetails: { minimumCount: 0, maximumCount: 1 } }
      ]
    });

    const service = createService(CodePipelineService, 'codepipeline');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_codepipeline:deploy',
      'aws_codepipeline:release',
      'aws_codepipeline_custom_action_type:Build:terraform:1',
      'aws_codepipeline_webhook:arn:aws:codepipeline:us-east-1:1:webhook:gh'
    ]);
    expect(codepipeline.commandCalls(ListPipelinesCommand)[1].args[0].input).toMatchObject({ nextToken: 'p2' });
    expect(codepipeline.commandCalls(ListActionTypesCommand)[0].args[0].input).toMatchObject({ actionOwnerFilter: 'Custom' });
    // The webhook secret never reaches the attributes.
    expect(JSON.stringify(service.getResources().map(r => r.attributes))).not.toContain('super-secret');
    expect(service.getWarnings()).toEqual([]);
  });
});
