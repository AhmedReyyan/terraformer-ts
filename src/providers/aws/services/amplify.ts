import {
  AmplifyClient,
  App,
  ListWebhooksCommand,
  ListBackendEnvironmentsCommand,
  paginateListApps,
  paginateListBranches,
  paginateListDomainAssociations
} from '@aws-sdk/client-amplify';
import { AwsService } from '../aws-service';
import { mapLimit } from '../../../core/provider';

export class AmplifyService extends AwsService {
  async initResources(): Promise<void> {
    const amplify = this.client(AmplifyClient);
    const apps: App[] = [];

    await this.collect('Amplify apps', async () => {
      for await (const page of paginateListApps({ client: amplify }, {})) {
        for (const app of page.apps || []) {
          if (app.appId) {
            apps.push(app);
            // environmentVariables may hold secrets, so they are not kept as attributes.
            this.add('aws_amplify_app', app.appId, app.name || app.appId, {
              id: app.appId, name: app.name, arn: app.appArn, tags: app.tags || {}
            });
          }
        }
      }
    });

    await mapLimit(apps, 5, async app => {
      const appId = app.appId as string;
      const appName = app.name || appId;

      await this.collect(`Amplify branches of ${appName}`, async () => {
        for await (const page of paginateListBranches({ client: amplify }, { appId })) {
          for (const branch of page.branches || []) {
            if (branch.branchName) {
              this.add('aws_amplify_branch', `${appId}/${branch.branchName}`, `${appName}-${branch.branchName}`, {
                app_id: appId, branch_name: branch.branchName, arn: branch.branchArn, tags: branch.tags || {}
              });
            }
          }
        }
      });

      await this.collect(`Amplify domain associations of ${appName}`, async () => {
        for await (const page of paginateListDomainAssociations({ client: amplify }, { appId })) {
          for (const domain of page.domainAssociations || []) {
            // Associations whose setup failed are skipped.
            if (domain.domainName && domain.domainStatus !== 'FAILED') {
              this.add('aws_amplify_domain_association', `${appId}/${domain.domainName}`, `${appName}-${domain.domainName}`, {
                app_id: appId, domain_name: domain.domainName, arn: domain.domainAssociationArn
              });
            }
          }
        }
      });

      await this.collect(`Amplify webhooks of ${appName}`, async () => {
        let nextToken: string | undefined;
        do {
          const page = await amplify.send(new ListWebhooksCommand({ appId, nextToken }));
          for (const webhook of page.webhooks || []) {
            if (webhook.webhookId) {
              this.add('aws_amplify_webhook', webhook.webhookId, `${appName}-${webhook.branchName || webhook.webhookId}`, {
                id: webhook.webhookId, app_id: appId, branch_name: webhook.branchName, arn: webhook.webhookArn
              });
            }
          }
          nextToken = page.nextToken;
        } while (nextToken);
      });

      await this.collect(`Amplify backend environments of ${appName}`, async () => {
        let nextToken: string | undefined;
        do {
          const page = await amplify.send(new ListBackendEnvironmentsCommand({ appId, nextToken }));
          for (const env of page.backendEnvironments || []) {
            if (env.environmentName) {
              this.add('aws_amplify_backend_environment', `${appId}/${env.environmentName}`, `${appName}-${env.environmentName}`, {
                app_id: appId, environment_name: env.environmentName, arn: env.backendEnvironmentArn
              });
            }
          }
          nextToken = page.nextToken;
        } while (nextToken);
      });
    });
  }
}
