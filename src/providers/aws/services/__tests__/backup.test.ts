import { mockClient } from 'aws-sdk-client-mock';
import {
  BackupClient,
  ListBackupVaultsCommand,
  ListBackupPlansCommand,
  ListBackupSelectionsCommand,
  GetBackupVaultAccessPolicyCommand,
  GetBackupVaultNotificationsCommand
} from '@aws-sdk/client-backup';
import { BackupService } from '../backup';
import { createService, importIds, notFound } from './helpers';

const backup = mockClient(BackupClient);

beforeEach(() => {
  backup.reset();
  backup.on(ListBackupPlansCommand).resolves({ BackupPlansList: [] });
  backup.on(GetBackupVaultAccessPolicyCommand).rejects(notFound());
  backup.on(GetBackupVaultNotificationsCommand).rejects(notFound());
});

describe('BackupService', () => {
  it('imports user vaults with policy, notifications and lock, skipping default/AWS/other vault types', async () => {
    backup.on(ListBackupVaultsCommand).resolvesOnce({
      BackupVaultList: [
        { BackupVaultName: 'Default', VaultType: 'BACKUP_VAULT' },
        { BackupVaultName: 'aws/efs/automatic-backup-vault', VaultType: 'BACKUP_VAULT' },
        { BackupVaultName: 'prod', VaultType: 'BACKUP_VAULT', MinRetentionDays: 7 }
      ],
      NextToken: 'v2'
    }).resolvesOnce({
      BackupVaultList: [
        { BackupVaultName: 'airgap', VaultType: 'LOGICALLY_AIR_GAPPED_BACKUP_VAULT' },
        { BackupVaultName: 'broken', VaultType: 'BACKUP_VAULT', VaultState: 'FAILED' },
        { BackupVaultName: 'dev' }
      ]
    });
    backup.on(GetBackupVaultAccessPolicyCommand, { BackupVaultName: 'prod' }).resolves({ Policy: '{}' });
    backup.on(GetBackupVaultNotificationsCommand, { BackupVaultName: 'prod' }).resolves({ SNSTopicArn: 'arn:aws:sns:us-east-1:123:t' });

    const service = createService(BackupService, 'backup');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_backup_vault:dev',
      'aws_backup_vault:prod',
      'aws_backup_vault_lock_configuration:prod',
      'aws_backup_vault_notifications:prod',
      'aws_backup_vault_policy:prod'
    ]);
    expect(backup.commandCalls(ListBackupVaultsCommand)[1].args[0].input).toMatchObject({ NextToken: 'v2' });
    expect(service.getWarnings()).toEqual([]);
  });

  it('imports plans and their selections as plan_id|selection_id, skipping deleted plans', async () => {
    backup.on(ListBackupVaultsCommand).resolves({ BackupVaultList: [] });
    backup.on(ListBackupPlansCommand).resolves({
      BackupPlansList: [
        { BackupPlanId: 'plan-1', BackupPlanName: 'daily' },
        { BackupPlanId: 'plan-2', BackupPlanName: 'old', DeletionDate: new Date() }
      ]
    });
    backup.on(ListBackupSelectionsCommand, { BackupPlanId: 'plan-1' })
      .resolvesOnce({ BackupSelectionsList: [{ SelectionId: 'sel-1', SelectionName: 'ec2' }], NextToken: 's2' })
      .resolvesOnce({ BackupSelectionsList: [{ SelectionId: 'sel-2', SelectionName: 'rds' }] });

    const service = createService(BackupService, 'backup');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_backup_plan:plan-1',
      'aws_backup_selection:plan-1|sel-1',
      'aws_backup_selection:plan-1|sel-2'
    ]);
  });
});
