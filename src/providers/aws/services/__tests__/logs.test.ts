import { mockClient } from 'aws-sdk-client-mock';
import {
  CloudWatchLogsClient,
  DescribeDestinationsCommand,
  DescribeLogGroupsCommand,
  DescribeMetricFiltersCommand,
  DescribeQueryDefinitionsCommand,
  DescribeResourcePoliciesCommand,
  DescribeSubscriptionFiltersCommand
} from '@aws-sdk/client-cloudwatch-logs';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { CloudWatchLogsService } from '../logs';
import { createService, importIds } from './helpers';

const logs = mockClient(CloudWatchLogsClient);
const sts = mockClient(STSClient);

beforeEach(() => {
  logs.reset();
  sts.reset();
  sts.on(GetCallerIdentityCommand).resolves({ Account: '123456789012' });
  logs.on(DescribeSubscriptionFiltersCommand).resolves({});
  logs.on(DescribeMetricFiltersCommand).resolves({});
  logs.on(DescribeResourcePoliciesCommand).resolves({});
  logs.on(DescribeQueryDefinitionsCommand).resolves({});
  logs.on(DescribeDestinationsCommand).resolves({});
});

describe('CloudWatchLogsService', () => {
  it('imports log groups across pages with their filters, policies, queries and destinations', async () => {
    logs.on(DescribeLogGroupsCommand)
      .resolvesOnce({ logGroups: [{ logGroupName: '/app/web', dataProtectionStatus: 'ACTIVATED' }], nextToken: 'p2' })
      .resolvesOnce({ logGroups: [{ logGroupName: '/app/worker', dataProtectionStatus: 'DISABLED' }] });
    logs.on(DescribeMetricFiltersCommand).resolves({ metricFilters: [{ logGroupName: '/app/web', filterName: 'errors' }] });
    logs.on(DescribeSubscriptionFiltersCommand, { logGroupName: '/app/worker' }).resolves({
      subscriptionFilters: [{ filterName: 'to-kinesis', logGroupName: '/app/worker' }]
    });
    logs.on(DescribeResourcePoliciesCommand)
      .resolvesOnce({ resourcePolicies: [{ policyName: 'route53-query-logging' }], nextToken: 'p2' })
      .resolvesOnce({ resourcePolicies: [{ policyName: 'es-logs' }] });
    logs.on(DescribeQueryDefinitionsCommand).resolves({
      queryDefinitions: [{ queryDefinitionId: '269951d7-6f75-496d-9d7b-6b7a5486bdbd', name: 'errors' }]
    });
    logs.on(DescribeDestinationsCommand).resolves({
      destinations: [{ destinationName: 'central', accessPolicy: '{}' }, { destinationName: 'no-policy' }]
    });

    const service = createService(CloudWatchLogsService, 'logs', 'eu-west-1');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_cloudwatch_log_data_protection_policy:/app/web',
      'aws_cloudwatch_log_destination:central',
      'aws_cloudwatch_log_destination:no-policy',
      'aws_cloudwatch_log_destination_policy:central',
      'aws_cloudwatch_log_group:/app/web',
      'aws_cloudwatch_log_group:/app/worker',
      'aws_cloudwatch_log_metric_filter:/app/web:errors',
      'aws_cloudwatch_log_resource_policy:es-logs',
      'aws_cloudwatch_log_resource_policy:route53-query-logging',
      'aws_cloudwatch_log_subscription_filter:/app/worker|to-kinesis',
      'aws_cloudwatch_query_definition:arn:aws:logs:eu-west-1:123456789012:query-definition:269951d7-6f75-496d-9d7b-6b7a5486bdbd'
    ]);
    expect(logs.commandCalls(DescribeLogGroupsCommand)[1].args[0].input).toMatchObject({ nextToken: 'p2' });
    expect(logs.commandCalls(DescribeResourcePoliciesCommand)[1].args[0].input).toMatchObject({ nextToken: 'p2' });
    expect(service.getWarnings()).toEqual([]);
  });

  it('builds query definition ARNs in the partition of the region', async () => {
    logs.on(DescribeLogGroupsCommand).resolves({});
    logs.on(DescribeQueryDefinitionsCommand).resolves({ queryDefinitions: [{ queryDefinitionId: 'q1' }] });

    const service = createService(CloudWatchLogsService, 'logs', 'cn-north-1');
    await service.initResources();

    expect(importIds(service)).toEqual(['aws_cloudwatch_query_definition:arn:aws-cn:logs:cn-north-1:123456789012:query-definition:q1']);
  });
});
