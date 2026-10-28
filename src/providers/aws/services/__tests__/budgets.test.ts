import { mockClient } from 'aws-sdk-client-mock';
import { BudgetsClient, DescribeBudgetActionsForAccountCommand, DescribeBudgetsCommand } from '@aws-sdk/client-budgets';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { BudgetsService } from '../budgets';
import { createService, importIds } from './helpers';

const budgets = mockClient(BudgetsClient);
const sts = mockClient(STSClient);

beforeEach(() => {
  budgets.reset();
  sts.reset();
  sts.on(GetCallerIdentityCommand).resolves({ Account: '123456789012' });
});

describe('BudgetsService', () => {
  it('is a global service', () => {
    expect(BudgetsService.global).toBe(true);
  });

  it('imports budgets across pages and budget actions with the account ID in the import ID', async () => {
    budgets.on(DescribeBudgetsCommand)
      .resolvesOnce({ Budgets: [{ BudgetName: 'monthly', BudgetType: 'COST', TimeUnit: 'MONTHLY' }], NextToken: 'p2' })
      .resolvesOnce({ Budgets: [{ BudgetName: 'ec2-usage', BudgetType: 'USAGE', TimeUnit: 'MONTHLY' }] });
    budgets.on(DescribeBudgetActionsForAccountCommand).resolves({
      Actions: [{
        ActionId: 'act-1',
        BudgetName: 'monthly',
        NotificationType: 'ACTUAL',
        ActionType: 'APPLY_IAM_POLICY',
        ActionThreshold: { ActionThresholdValue: 100, ActionThresholdType: 'PERCENTAGE' },
        Definition: {},
        ExecutionRoleArn: 'arn:aws:iam::123456789012:role/budgets',
        ApprovalModel: 'AUTOMATIC',
        Status: 'STANDBY',
        Subscribers: []
      }]
    });

    const service = createService(BudgetsService, 'budgets');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_budgets_budget:123456789012:ec2-usage',
      'aws_budgets_budget:123456789012:monthly',
      'aws_budgets_budget_action:123456789012:act-1:monthly'
    ]);
    const calls = budgets.commandCalls(DescribeBudgetsCommand);
    expect(calls[0].args[0].input).toMatchObject({ AccountId: '123456789012' });
    expect(calls[1].args[0].input).toMatchObject({ NextToken: 'p2' });
    expect(service.getWarnings()).toEqual([]);
  });
});
