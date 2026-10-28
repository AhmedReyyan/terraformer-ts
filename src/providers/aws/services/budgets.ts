import { BudgetsClient, paginateDescribeBudgetActionsForAccount, paginateDescribeBudgets } from '@aws-sdk/client-budgets';
import { AwsService } from '../aws-service';

export class BudgetsService extends AwsService {
  static readonly global = true;

  async initResources(): Promise<void> {
    const budgets = this.client(BudgetsClient);

    await this.collect('budgets', async () => {
      const accountId = await this.accountId();
      for await (const page of paginateDescribeBudgets({ client: budgets }, { AccountId: accountId })) {
        for (const budget of page.Budgets || []) {
          if (budget.BudgetName) {
            this.add('aws_budgets_budget', `${accountId}:${budget.BudgetName}`, budget.BudgetName, {
              name: budget.BudgetName,
              budget_type: budget.BudgetType
            });
          }
        }
      }
    });

    await this.collect('budget actions', async () => {
      const accountId = await this.accountId();
      for await (const page of paginateDescribeBudgetActionsForAccount({ client: budgets }, { AccountId: accountId })) {
        for (const action of page.Actions || []) {
          if (action.ActionId && action.BudgetName) {
            this.add('aws_budgets_budget_action', `${accountId}:${action.ActionId}:${action.BudgetName}`,
              `${action.BudgetName}-${action.ActionType || 'action'}`, {
                action_id: action.ActionId,
                budget_name: action.BudgetName,
                action_type: action.ActionType
              });
          }
        }
      }
    });
  }
}
