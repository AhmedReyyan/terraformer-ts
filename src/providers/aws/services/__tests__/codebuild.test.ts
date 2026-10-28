import { mockClient } from 'aws-sdk-client-mock';
import {
  CodeBuildClient,
  ListProjectsCommand,
  BatchGetProjectsCommand,
  ListReportGroupsCommand,
  ListFleetsCommand
} from '@aws-sdk/client-codebuild';
import { CodeBuildService } from '../codebuild';
import { createService, importIds } from './helpers';

const codebuild = mockClient(CodeBuildClient);

beforeEach(() => {
  codebuild.reset();
  codebuild.on(ListProjectsCommand).resolves({});
  codebuild.on(BatchGetProjectsCommand).resolves({});
  codebuild.on(ListReportGroupsCommand).resolves({});
  codebuild.on(ListFleetsCommand).resolves({});
});

describe('CodeBuildService', () => {
  it('imports projects over several pages with their webhooks', async () => {
    codebuild.on(ListProjectsCommand).resolvesOnce({ projects: ['api'], nextToken: 'p2' }).resolvesOnce({ projects: ['web'] });
    codebuild.on(BatchGetProjectsCommand).resolves({
      projects: [
        { name: 'api', arn: 'arn:aws:codebuild:us-east-1:1:project/api', tags: [{ key: 'team', value: 'core' }], webhook: { url: 'https://hook' } },
        { name: 'web', arn: 'arn:aws:codebuild:us-east-1:1:project/web' }
      ]
    });

    const service = createService(CodeBuildService, 'codebuild');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_codebuild_project:api',
      'aws_codebuild_project:web',
      'aws_codebuild_webhook:api'
    ]);
    expect(codebuild.commandCalls(ListProjectsCommand)[1].args[0].input).toMatchObject({ nextToken: 'p2' });
    expect(codebuild.commandCalls(BatchGetProjectsCommand)[0].args[0].input).toEqual({ names: ['api', 'web'] });
    expect(service.getResources().find(r => r.id === 'api' && r.type === 'aws_codebuild_project')?.attributes.tags).toEqual({ team: 'core' });
  });

  it('describes projects in batches of 100', async () => {
    const names = Array.from({ length: 150 }, (_, i) => `p${i}`);
    codebuild.on(ListProjectsCommand).resolves({ projects: names });

    const service = createService(CodeBuildService, 'codebuild');
    await service.initResources();

    const batches = codebuild.commandCalls(BatchGetProjectsCommand).map(call => call.args[0].input.names?.length);
    expect(batches).toEqual([100, 50]);
  });

  it('imports report groups and fleets by ARN', async () => {
    codebuild.on(ListReportGroupsCommand).resolves({ reportGroups: ['arn:aws:codebuild:us-east-1:1:report-group/api-tests'] });
    codebuild.on(ListFleetsCommand).resolves({ fleets: ['arn:aws:codebuild:us-east-1:1:fleet/linux:0b5c1f'] });

    const service = createService(CodeBuildService, 'codebuild');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_codebuild_fleet:arn:aws:codebuild:us-east-1:1:fleet/linux:0b5c1f',
      'aws_codebuild_report_group:arn:aws:codebuild:us-east-1:1:report-group/api-tests'
    ]);
    expect(service.getResources().map(r => r.attributes.name).sort()).toEqual(['api-tests', 'linux']);
  });
});
