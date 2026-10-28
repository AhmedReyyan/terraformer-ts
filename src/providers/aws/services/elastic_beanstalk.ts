import {
  ElasticBeanstalkClient,
  DescribeApplicationsCommand,
  DescribeEnvironmentsCommand
} from '@aws-sdk/client-elastic-beanstalk';
import { AwsService } from '../aws-service';

/**
 * Elastic Beanstalk applications and environments. Application versions and configuration
 * templates are not imported: their Terraform resources do not support import.
 */
export class ElasticBeanstalkService extends AwsService {
  async initResources(): Promise<void> {
    const eb = this.client(ElasticBeanstalkClient);

    await this.collect('Elastic Beanstalk applications', async () => {
      // DescribeApplications is not paginated: it returns every application.
      const response = await eb.send(new DescribeApplicationsCommand({}));
      for (const app of response.Applications || []) {
        if (app.ApplicationName) {
          this.add('aws_elastic_beanstalk_application', app.ApplicationName, app.ApplicationName, {
            name: app.ApplicationName,
            arn: app.ApplicationArn
          });
        }
      }
    });

    await this.collect('Elastic Beanstalk environments', async () => {
      let nextToken: string | undefined;
      do {
        const response = await eb.send(new DescribeEnvironmentsCommand({ IncludeDeleted: false, NextToken: nextToken }));
        for (const env of response.Environments || []) {
          // Skip environments that are terminated or being terminated.
          if (!env.EnvironmentId || env.Status === 'Terminated' || env.Status === 'Terminating') {
            continue;
          }
          this.add('aws_elastic_beanstalk_environment', env.EnvironmentId, env.EnvironmentName || env.EnvironmentId, {
            id: env.EnvironmentId,
            name: env.EnvironmentName,
            application: env.ApplicationName,
            arn: env.EnvironmentArn
          });
        }
        nextToken = response.NextToken;
      } while (nextToken);
    });
  }
}
