import {
  CloudWatchLogsClient,
  DescribeQueryDefinitionsCommand,
  DescribeResourcePoliciesCommand,
  paginateDescribeDestinations,
  paginateDescribeLogGroups,
  paginateDescribeMetricFilters,
  paginateDescribeSubscriptionFilters
} from '@aws-sdk/client-cloudwatch-logs';
import { mapLimit } from '../../../core/provider';
import { AwsService } from '../aws-service';

/** The ARN partition of a region (query definitions are imported by ARN). */
function partitionOf(region: string): string {
  if (region.startsWith('cn-')) return 'aws-cn';
  if (region.startsWith('us-gov-')) return 'aws-us-gov';
  if (region.startsWith('us-iso-')) return 'aws-iso';
  if (region.startsWith('us-isob-')) return 'aws-iso-b';
  return 'aws';
}

export class CloudWatchLogsService extends AwsService {
  async initResources(): Promise<void> {
    const logs = this.client(CloudWatchLogsClient);
    const logGroups: string[] = [];

    await this.collect('CloudWatch log groups', async () => {
      for await (const page of paginateDescribeLogGroups({ client: logs }, {})) {
        for (const group of page.logGroups || []) {
          const name = group.logGroupName;
          if (!name) continue;
          logGroups.push(name);
          this.add('aws_cloudwatch_log_group', name, name, { name, arn: group.logGroupArn });
          // Only an active data protection policy exists as a resource (DELETED/DISABLED/ARCHIVED do not).
          if (group.dataProtectionStatus === 'ACTIVATED') {
            this.add('aws_cloudwatch_log_data_protection_policy', name, name, { log_group_name: name });
          }
        }
      }
    });

    await this.collect('CloudWatch log metric filters', async () => {
      // Listed account-wide: every filter carries its log group name.
      for await (const page of paginateDescribeMetricFilters({ client: logs }, {})) {
        for (const filter of page.metricFilters || []) {
          if (filter.logGroupName && filter.filterName) {
            this.add('aws_cloudwatch_log_metric_filter', `${filter.logGroupName}:${filter.filterName}`, filter.filterName, {
              name: filter.filterName,
              log_group_name: filter.logGroupName
            });
          }
        }
      }
    });

    await mapLimit(logGroups, 5, logGroupName =>
      this.collect(`subscription filters of log group ${logGroupName}`, async () => {
        for await (const page of paginateDescribeSubscriptionFilters({ client: logs }, { logGroupName })) {
          for (const filter of page.subscriptionFilters || []) {
            if (filter.filterName) {
              // Subscription filters use a vertical bar, unlike metric filters.
              this.add('aws_cloudwatch_log_subscription_filter', `${logGroupName}|${filter.filterName}`, filter.filterName, {
                name: filter.filterName,
                log_group_name: logGroupName,
                destination_arn: filter.destinationArn
              });
            }
          }
        }
      })
    );

    await this.collect('CloudWatch log resource policies', async () => {
      // Account-scoped policies only (the API default); resource-scoped ones would need a call per log group.
      let nextToken: string | undefined;
      do {
        const page = await logs.send(new DescribeResourcePoliciesCommand({ nextToken }));
        for (const policy of page.resourcePolicies || []) {
          if (policy.policyName) {
            this.add('aws_cloudwatch_log_resource_policy', policy.policyName, policy.policyName, { name: policy.policyName });
          }
        }
        nextToken = page.nextToken;
      } while (nextToken);
    });

    await this.collect('CloudWatch Logs Insights query definitions', async () => {
      const accountId = await this.accountId();
      const prefix = `arn:${partitionOf(this.region)}:logs:${this.region}:${accountId}:query-definition:`;
      let nextToken: string | undefined;
      do {
        const page = await logs.send(new DescribeQueryDefinitionsCommand({ nextToken }));
        for (const query of page.queryDefinitions || []) {
          if (query.queryDefinitionId) {
            const arn = prefix + query.queryDefinitionId;
            this.add('aws_cloudwatch_query_definition', arn, query.name || query.queryDefinitionId, {
              name: query.name,
              id: query.queryDefinitionId,
              arn
            });
          }
        }
        nextToken = page.nextToken;
      } while (nextToken);
    });

    await this.collect('CloudWatch Logs destinations', async () => {
      for await (const page of paginateDescribeDestinations({ client: logs }, {})) {
        for (const destination of page.destinations || []) {
          const name = destination.destinationName;
          if (!name) continue;
          this.add('aws_cloudwatch_log_destination', name, name, { name, arn: destination.arn });
          // The access policy is a separate resource, not an attribute of aws_cloudwatch_log_destination.
          if (destination.accessPolicy) {
            this.add('aws_cloudwatch_log_destination_policy', name, name, { destination_name: name });
          }
        }
      }
    });
  }
}
