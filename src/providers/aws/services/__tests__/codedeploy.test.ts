import { mockClient } from 'aws-sdk-client-mock';
import {
  CodeDeployClient,
  ListApplicationsCommand,
  ListDeploymentGroupsCommand,
  ListDeploymentConfigsCommand
} from '@aws-sdk/client-codedeploy';
import { CodeDeployService } from '../codedeploy';
import { createService, importIds } from './helpers';

const codedeploy = mockClient(CodeDeployClient);

beforeEach(() => {
  codedeploy.reset();
  codedeploy.on(ListApplicationsCommand).resolves({});
  codedeploy.on(ListDeploymentGroupsCommand).resolves({});
  codedeploy.on(ListDeploymentConfigsCommand).resolves({});
});

describe('CodeDeployService', () => {
  it('imports applications, deployment groups and custom deployment configs', async () => {
    codedeploy.on(ListApplicationsCommand).resolvesOnce({ applications: ['api'], nextToken: 'a2' })
      .resolvesOnce({ applications: ['web'] });
    codedeploy.on(ListDeploymentGroupsCommand, { applicationName: 'api' })
      .resolvesOnce({ applicationName: 'api', deploymentGroups: ['prod'], nextToken: 'g2' })
      .resolvesOnce({ applicationName: 'api', deploymentGroups: ['staging'] });
    codedeploy.on(ListDeploymentConfigsCommand).resolves({
      deploymentConfigsList: ['CodeDeployDefault.OneAtATime', 'CodeDeployDefault.LambdaAllAtOnce', 'HalfAtATime']
    });

    const service = createService(CodeDeployService, 'codedeploy');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_codedeploy_app:api',
      'aws_codedeploy_app:web',
      'aws_codedeploy_deployment_config:HalfAtATime',
      'aws_codedeploy_deployment_group:api:prod',
      'aws_codedeploy_deployment_group:api:staging'
    ]);
    expect(codedeploy.commandCalls(ListApplicationsCommand)[1].args[0].input).toMatchObject({ nextToken: 'a2' });
    expect(service.getWarnings()).toEqual([]);
  });

  it('keeps the applications when deployment groups cannot be listed', async () => {
    codedeploy.on(ListApplicationsCommand).resolves({ applications: ['api'] });
    codedeploy.on(ListDeploymentGroupsCommand).rejects(Object.assign(new Error('denied'), { name: 'AccessDeniedException' }));

    const service = createService(CodeDeployService, 'codedeploy');
    await service.initResources();

    expect(importIds(service)).toEqual(['aws_codedeploy_app:api']);
    expect(service.getWarnings()[0]).toContain('AccessDeniedException');
  });
});
