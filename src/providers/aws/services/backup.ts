import {
  BackupClient,
  paginateListBackupVaults,
  paginateListBackupPlans,
  paginateListBackupSelections,
  GetBackupVaultAccessPolicyCommand,
  GetBackupVaultNotificationsCommand
} from '@aws-sdk/client-backup';
import { mapLimit } from '../../../core/provider';
import { AwsService, optional } from '../aws-service';

/** AWS Backup vaults (with policy, notifications and lock), plans and selections. */
export class BackupService extends AwsService {
  async initResources(): Promise<void> {
    const backup = this.client(BackupClient);
    const vaults: string[] = [];

    await this.collect('Backup vaults', async () => {
      for await (const page of paginateListBackupVaults({ client: backup }, {})) {
        for (const vault of page.BackupVaultList || []) {
          const name = vault.BackupVaultName;
          // Skip: logically air-gapped / restore-access vaults (other resource types),
          // failed vaults, the `Default` vault AWS creates on first use, and vaults
          // created by other AWS services (`aws/...`, e.g. aws/efs/automatic-backup-vault).
          if (!name || (vault.VaultType && vault.VaultType !== 'BACKUP_VAULT') || vault.VaultState === 'FAILED' ||
              name === 'Default' || name.startsWith('aws/')) {
            continue;
          }
          vaults.push(name);
          this.add('aws_backup_vault', name, name, { name, arn: vault.BackupVaultArn });
          if (vault.MinRetentionDays !== undefined || vault.MaxRetentionDays !== undefined) {
            this.add('aws_backup_vault_lock_configuration', name, name, { backup_vault_name: name });
          }
        }
      }
    });

    await mapLimit(vaults, 5, name => this.collect(`Backup vault ${name} policy and notifications`, async () => {
      const [policy, notifications] = await Promise.all([
        optional(backup.send(new GetBackupVaultAccessPolicyCommand({ BackupVaultName: name }))),
        optional(backup.send(new GetBackupVaultNotificationsCommand({ BackupVaultName: name })))
      ]);
      if (policy?.Policy) {
        this.add('aws_backup_vault_policy', name, name, { backup_vault_name: name });
      }
      if (notifications?.SNSTopicArn) {
        this.add('aws_backup_vault_notifications', name, name, { backup_vault_name: name, sns_topic_arn: notifications.SNSTopicArn });
      }
    }));

    const plans: Array<{ id: string; name: string }> = [];
    await this.collect('Backup plans', async () => {
      // Deleted plans are not listed unless IncludeDeleted is set.
      for await (const page of paginateListBackupPlans({ client: backup }, {})) {
        for (const plan of page.BackupPlansList || []) {
          if (!plan.BackupPlanId || plan.DeletionDate) {
            continue;
          }
          const name = plan.BackupPlanName || plan.BackupPlanId;
          plans.push({ id: plan.BackupPlanId, name });
          this.add('aws_backup_plan', plan.BackupPlanId, name, { id: plan.BackupPlanId, name, arn: plan.BackupPlanArn });
        }
      }
    });

    await mapLimit(plans, 5, plan => this.collect(`Backup selections of ${plan.name}`, async () => {
      for await (const page of paginateListBackupSelections({ client: backup }, { BackupPlanId: plan.id })) {
        for (const selection of page.BackupSelectionsList || []) {
          if (!selection.SelectionId) {
            continue;
          }
          this.add('aws_backup_selection', `${plan.id}|${selection.SelectionId}`,
            `${plan.name}-${selection.SelectionName || selection.SelectionId}`, {
              id: selection.SelectionId,
              name: selection.SelectionName,
              plan_id: plan.id
            });
        }
      }
    }));
  }
}
