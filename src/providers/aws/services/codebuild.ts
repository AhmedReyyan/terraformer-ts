import {
  CodeBuildClient,
  paginateListProjects,
  paginateListReportGroups,
  paginateListFleets,
  BatchGetProjectsCommand,
  Tag
} from '@aws-sdk/client-codebuild';
import { AwsService } from '../aws-service';

/** CodeBuild tags use lowercase `key`/`value`. */
function codeBuildTags(tags?: Tag[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const tag of tags || []) {
    if (tag.key !== undefined) {
      map[tag.key] = tag.value ?? '';
    }
  }
  return map;
}

/** BatchGetProjects accepts at most 100 names. */
const BATCH_SIZE = 100;

export class CodeBuildService extends AwsService {
  async initResources(): Promise<void> {
    const codebuild = this.client(CodeBuildClient);

    // aws_codebuild_source_credential is not imported: it holds a secret token that the API never returns.
    await this.collect('CodeBuild projects', async () => {
      const names: string[] = [];
      for await (const page of paginateListProjects({ client: codebuild }, {})) {
        names.push(...(page.projects || []));
      }
      for (let i = 0; i < names.length; i += BATCH_SIZE) {
        const response = await codebuild.send(new BatchGetProjectsCommand({ names: names.slice(i, i + BATCH_SIZE) }));
        for (const project of response.projects || []) {
          const name = project.name!;
          this.add('aws_codebuild_project', name, name, { name, arn: project.arn, tags: codeBuildTags(project.tags) });
          // The webhook is a separate resource, imported by project name.
          if (project.webhook) {
            this.add('aws_codebuild_webhook', name, name, { project_name: name, url: project.webhook.url });
          }
        }
      }
    });

    await this.collect('CodeBuild report groups', async () => {
      for await (const page of paginateListReportGroups({ client: codebuild }, {})) {
        for (const arn of page.reportGroups || []) {
          const name = arn.split(':report-group/').pop() || arn;
          this.add('aws_codebuild_report_group', arn, name, { name, arn });
        }
      }
    });

    await this.collect('CodeBuild fleets', async () => {
      for await (const page of paginateListFleets({ client: codebuild }, {})) {
        for (const arn of page.fleets || []) {
          // Fleet ARNs look like arn:aws:codebuild:<region>:<account>:fleet/<name>:<uuid>.
          const name = arn.split(':fleet/').pop()?.split(':')[0] || arn;
          this.add('aws_codebuild_fleet', arn, name, { name, arn });
        }
      }
    });
  }
}
