import {
  CodeDeployClient,
  paginateListApplications,
  paginateListDeploymentGroups,
  paginateListDeploymentConfigs
} from '@aws-sdk/client-codedeploy';
import { mapLimit } from '../../../core/provider';
import { AwsService } from '../aws-service';

export class CodeDeployService extends AwsService {
  async initResources(): Promise<void> {
    const codedeploy = this.client(CodeDeployClient);
    const applications: string[] = [];

    await this.collect('CodeDeploy applications', async () => {
      for await (const page of paginateListApplications({ client: codedeploy }, {})) {
        for (const name of page.applications || []) {
          applications.push(name);
          this.add('aws_codedeploy_app', name, name, { name });
        }
      }
    });

    await mapLimit(applications, 5, application =>
      this.collect(`CodeDeploy deployment groups of ${application}`, async () => {
        for await (const page of paginateListDeploymentGroups({ client: codedeploy }, { applicationName: application })) {
          for (const group of page.deploymentGroups || []) {
            this.add('aws_codedeploy_deployment_group', `${application}:${group}`, `${application}_${group}`, {
              app_name: application,
              deployment_group_name: group
            });
          }
        }
      })
    );

    await this.collect('CodeDeploy deployment configs', async () => {
      for await (const page of paginateListDeploymentConfigs({ client: codedeploy }, {})) {
        for (const name of page.deploymentConfigsList || []) {
          // Built-in configurations (CodeDeployDefault.*) are owned by AWS.
          if (name.startsWith('CodeDeployDefault.')) {
            continue;
          }
          this.add('aws_codedeploy_deployment_config', name, name, { deployment_config_name: name });
        }
      }
    });
  }
}
