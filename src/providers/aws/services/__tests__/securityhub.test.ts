import { mockClient } from 'aws-sdk-client-mock';
import {
  SecurityHubClient,
  DescribeHubCommand,
  GetEnabledStandardsCommand,
  DescribeActionTargetsCommand,
  GetInsightsCommand,
  ListAutomationRulesCommand,
  ListFindingAggregatorsCommand,
  ListEnabledProductsForImportCommand,
  DescribeProductsCommand
} from '@aws-sdk/client-securityhub';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { SecurityHubService } from '../securityhub';
import { createService, importIds } from './helpers';

const hub = mockClient(SecurityHubClient);
const sts = mockClient(STSClient);

const prefix = 'arn:aws:securityhub:eu-west-1:123456789012';

beforeEach(() => {
  hub.reset();
  sts.reset();
  sts.on(GetCallerIdentityCommand).resolves({ Account: '123456789012' });
});

describe('SecurityHubService', () => {
  it('imports the account and its configuration when Security Hub is enabled', async () => {
    hub.on(DescribeHubCommand).resolves({ HubArn: `${prefix}:hub/default` });
    hub.on(GetEnabledStandardsCommand)
      .resolvesOnce({
        StandardsSubscriptions: [
          { StandardsSubscriptionArn: `${prefix}:subscription/cis-aws-foundations-benchmark/v/1.2.0`, StandardsStatus: 'READY', StandardsArn: 's', StandardsInput: {} }
        ],
        NextToken: 'n'
      })
      .resolves({
        StandardsSubscriptions: [
          { StandardsSubscriptionArn: `${prefix}:subscription/pci-dss/v/3.2.1`, StandardsStatus: 'DELETING', StandardsArn: 's', StandardsInput: {} },
          { StandardsSubscriptionArn: `${prefix}:subscription/nist/v/5.0.0`, StandardsStatus: 'FAILED', StandardsArn: 's', StandardsInput: {} }
        ]
      });
    hub.on(DescribeActionTargetsCommand).resolves({ ActionTargets: [{ ActionTargetArn: `${prefix}:action/custom/a`, Name: 'a', Description: '' }] });
    hub.on(GetInsightsCommand).resolves({
      Insights: [
        { InsightArn: `${prefix}:insight/123456789012/custom/u1`, Name: 'mine', Filters: {}, GroupByAttribute: 'Type' },
        { InsightArn: 'arn:aws:securityhub:::insight/securityhub/default/1', Name: 'managed', Filters: {}, GroupByAttribute: 'Type' }
      ]
    });
    hub.on(ListAutomationRulesCommand)
      .resolvesOnce({ AutomationRulesMetadata: [{ RuleArn: `${prefix}:automation-rule/r1`, RuleName: 'r1' }], NextToken: 't' })
      .resolves({ AutomationRulesMetadata: [{ RuleArn: `${prefix}:automation-rule/r2`, RuleName: 'r2' }] });
    hub.on(ListFindingAggregatorsCommand).resolves({ FindingAggregators: [{ FindingAggregatorArn: `${prefix}:finding-aggregator/agg1` }] });
    hub.on(ListEnabledProductsForImportCommand).resolves({
      ProductSubscriptions: [`${prefix}:product-subscription/aws/guardduty`, `${prefix}:product-subscription/crowdstrike/falcon`]
    });
    hub.on(DescribeProductsCommand).resolves({
      Products: [{ ProductArn: 'arn:aws:securityhub:eu-west-1:517716713836:product/crowdstrike/falcon' }]
    });

    const service = createService(SecurityHubService, 'securityhub', 'eu-west-1');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_securityhub_account:123456789012',
      `aws_securityhub_action_target:${prefix}:action/custom/a`,
      `aws_securityhub_automation_rule:${prefix}:automation-rule/r1`,
      `aws_securityhub_automation_rule:${prefix}:automation-rule/r2`,
      `aws_securityhub_finding_aggregator:${prefix}:finding-aggregator/agg1`,
      `aws_securityhub_insight:${prefix}:insight/123456789012/custom/u1`,
      `aws_securityhub_product_subscription:arn:aws:securityhub:eu-west-1:517716713836:product/crowdstrike/falcon,${prefix}:product-subscription/crowdstrike/falcon`,
      `aws_securityhub_standards_subscription:${prefix}:subscription/cis-aws-foundations-benchmark/v/1.2.0`
    ]);
    expect(hub.commandCalls(GetEnabledStandardsCommand)[1].args[0].input).toMatchObject({ NextToken: 'n' });
    expect(hub.commandCalls(ListAutomationRulesCommand)[1].args[0].input).toMatchObject({ NextToken: 't' });
    expect(service.getWarnings()).toEqual([]);
  });

  it('imports nothing when Security Hub is not enabled in the region', async () => {
    hub.on(DescribeHubCommand).rejects(Object.assign(new Error('not subscribed'), { name: 'InvalidAccessException' }));

    const service = createService(SecurityHubService, 'securityhub', 'eu-west-1');
    await service.initResources();

    expect(importIds(service)).toEqual([]);
    expect(service.getWarnings()).toEqual([]);
    expect(hub.commandCalls(GetEnabledStandardsCommand)).toHaveLength(0);
  });
});
