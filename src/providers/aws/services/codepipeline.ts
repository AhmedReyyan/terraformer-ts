import {
  CodePipelineClient,
  paginateListPipelines,
  paginateListWebhooks,
  paginateListActionTypes,
  Tag
} from '@aws-sdk/client-codepipeline';
import { AwsService } from '../aws-service';

/** CodePipeline tags use lowercase `key`/`value`. */
function codePipelineTags(tags?: Tag[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const tag of tags || []) {
    if (tag.key !== undefined) {
      map[tag.key] = tag.value ?? '';
    }
  }
  return map;
}

export class CodePipelineService extends AwsService {
  async initResources(): Promise<void> {
    const codepipeline = this.client(CodePipelineClient);

    await this.collect('CodePipeline pipelines', async () => {
      for await (const page of paginateListPipelines({ client: codepipeline }, {})) {
        for (const pipeline of page.pipelines || []) {
          const name = pipeline.name!;
          this.add('aws_codepipeline', name, name, { name, pipeline_type: pipeline.pipelineType });
        }
      }
    });

    await this.collect('CodePipeline webhooks', async () => {
      for await (const page of paginateListWebhooks({ client: codepipeline }, {})) {
        for (const webhook of page.webhooks || []) {
          // Only identifying fields: the definition also contains the authentication secret token.
          const name = webhook.definition?.name || webhook.arn!;
          this.add('aws_codepipeline_webhook', webhook.arn!, name, {
            name,
            arn: webhook.arn,
            target_pipeline: webhook.definition?.targetPipeline,
            tags: codePipelineTags(webhook.tags)
          });
        }
      }
    });

    // Only custom action types: AWS and ThirdParty action types are not owned by this account.
    await this.collect('CodePipeline custom action types', async () => {
      for await (const page of paginateListActionTypes({ client: codepipeline }, { actionOwnerFilter: 'Custom' })) {
        for (const actionType of page.actionTypes || []) {
          const id = actionType.id!;
          if (id.owner !== 'Custom') {
            continue;
          }
          this.add('aws_codepipeline_custom_action_type', `${id.category}:${id.provider}:${id.version}`, `${id.category}_${id.provider}_${id.version}`, {
            category: id.category,
            provider_name: id.provider,
            version: id.version
          });
        }
      }
    });
  }
}
