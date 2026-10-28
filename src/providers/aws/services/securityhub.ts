import {
  SecurityHubClient,
  DescribeHubCommand,
  paginateGetEnabledStandards,
  paginateDescribeActionTargets,
  paginateGetInsights,
  paginateListFindingAggregators,
  paginateListEnabledProductsForImport,
  paginateDescribeProducts,
  ListAutomationRulesCommand
} from '@aws-sdk/client-securityhub';
import { AwsService, isNotFound } from '../aws-service';

/**
 * Security Hub, only in regions where it is enabled (DescribeHub succeeds):
 * the account, standards subscriptions, custom actions, custom insights,
 * automation rules, finding aggregators and third-party product integrations.
 */
export class SecurityHubService extends AwsService {
  async initResources(): Promise<void> {
    const hub = this.client(SecurityHubClient);

    let enabled = false;
    await this.collect('Security Hub account', async () => {
      try {
        await hub.send(new DescribeHubCommand({}));
      } catch (error) {
        // Not subscribed to Security Hub in this region: nothing to import.
        const name = (error as { name?: string }).name || '';
        if (isNotFound(error) || name === 'InvalidAccessException') {
          return;
        }
        throw error;
      }
      enabled = true;
      const accountId = await this.accountId();
      this.add('aws_securityhub_account', accountId, `securityhub-${this.region}`, { account_id: accountId });
    });
    if (!enabled) {
      return;
    }

    await this.collect('Security Hub standards subscriptions', async () => {
      for await (const page of paginateGetEnabledStandards({ client: hub }, {})) {
        for (const subscription of page.StandardsSubscriptions || []) {
          // Subscriptions being removed or that failed to enable are skipped.
          const arn = subscription.StandardsSubscriptionArn;
          if (!arn || subscription.StandardsStatus === 'DELETING' || subscription.StandardsStatus === 'FAILED') {
            continue;
          }
          const name = arn.split(':subscription/').pop()!;
          this.add('aws_securityhub_standards_subscription', arn, name, {
            arn,
            standards_arn: subscription.StandardsArn
          });
        }
      }
    });

    await this.collect('Security Hub custom actions', async () => {
      for await (const page of paginateDescribeActionTargets({ client: hub }, {})) {
        for (const target of page.ActionTargets || []) {
          if (target.ActionTargetArn) {
            this.add('aws_securityhub_action_target', target.ActionTargetArn, target.Name || target.ActionTargetArn,
              { arn: target.ActionTargetArn, name: target.Name });
          }
        }
      }
    });

    await this.collect('Security Hub insights', async () => {
      for await (const page of paginateGetInsights({ client: hub }, {})) {
        for (const insight of page.Insights || []) {
          // Managed (AWS-provided) insights are not under `/custom/`.
          if (insight.InsightArn?.includes('/custom/')) {
            this.add('aws_securityhub_insight', insight.InsightArn, insight.Name || insight.InsightArn,
              { arn: insight.InsightArn, name: insight.Name });
          }
        }
      }
    });

    await this.collect('Security Hub automation rules', async () => {
      let nextToken: string | undefined;
      do {
        const page = await hub.send(new ListAutomationRulesCommand({ NextToken: nextToken }));
        for (const rule of page.AutomationRulesMetadata || []) {
          if (rule.RuleArn) {
            this.add('aws_securityhub_automation_rule', rule.RuleArn, rule.RuleName || rule.RuleArn,
              { arn: rule.RuleArn, name: rule.RuleName });
          }
        }
        nextToken = page.NextToken;
      } while (nextToken);
    });

    await this.collect('Security Hub finding aggregators', async () => {
      for await (const page of paginateListFindingAggregators({ client: hub }, {})) {
        for (const aggregator of page.FindingAggregators || []) {
          if (aggregator.FindingAggregatorArn) {
            this.add('aws_securityhub_finding_aggregator', aggregator.FindingAggregatorArn,
              `aggregator-${aggregator.FindingAggregatorArn.split('/').pop()}`,
              { arn: aggregator.FindingAggregatorArn });
          }
        }
      }
    });

    await this.collect('Security Hub product subscriptions', () => this.loadProductSubscriptions(hub));
  }

  private async loadProductSubscriptions(hub: SecurityHubClient): Promise<void> {
    const subscriptions: Array<{ arn: string; key: string }> = [];
    for await (const page of paginateListEnabledProductsForImport({ client: hub }, {})) {
      for (const arn of page.ProductSubscriptions || []) {
        const key = arn.split(':product-subscription/')[1];
        // Integrations with AWS services (`aws/...`) are enabled by Security Hub itself.
        if (key && !key.startsWith('aws/')) {
          subscriptions.push({ arn, key });
        }
      }
    }
    if (!subscriptions.length) {
      return;
    }
    // The import ID needs the product ARN, which for some partners contains their
    // account ID, so it is looked up instead of derived from the subscription ARN.
    const productArns = new Map<string, string>();
    for await (const page of paginateDescribeProducts({ client: hub }, {})) {
      for (const product of page.Products || []) {
        const key = product.ProductArn?.split(':product/')[1];
        if (key) {
          productArns.set(key, product.ProductArn!);
        }
      }
    }
    for (const { arn, key } of subscriptions) {
      const productArn = productArns.get(key);
      if (!productArn) {
        this.warn(`product subscription ${arn}: product not found`);
        continue;
      }
      this.add('aws_securityhub_product_subscription', `${productArn},${arn}`, key, { arn, product_arn: productArn });
    }
  }
}
