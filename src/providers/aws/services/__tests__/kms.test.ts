import { mockClient } from 'aws-sdk-client-mock';
import { KMSClient, ListKeysCommand, ListAliasesCommand, DescribeKeyCommand } from '@aws-sdk/client-kms';
import { KMSService } from '../kms';
import { createService, importIds } from './helpers';

const kms = mockClient(KMSClient);

beforeEach(() => kms.reset());

describe('KMSService', () => {
  it('imports customer managed keys, replicas, external keys and aliases', async () => {
    kms.on(ListKeysCommand).resolvesOnce({ Keys: [{ KeyId: 'k1' }, { KeyId: 'k2' }], Truncated: true, NextMarker: 'm' })
      .resolves({ Keys: [{ KeyId: 'k3' }, { KeyId: 'k4' }, { KeyId: 'k5' }, { KeyId: 'k6' }, { KeyId: 'k7' }] });
    kms.on(ListAliasesCommand).resolves({
      Aliases: [
        { AliasName: 'alias/app', TargetKeyId: 'k1', AliasArn: 'arn:alias/app' },
        { AliasName: 'alias/aws/s3', TargetKeyId: 'k3' },
        { AliasName: 'alias/unassigned' }
      ]
    });
    kms.on(DescribeKeyCommand, { KeyId: 'k1' }).resolves({ KeyMetadata: { KeyId: 'k1', KeyManager: 'CUSTOMER', KeyState: 'Enabled', Origin: 'AWS_KMS' } });
    kms.on(DescribeKeyCommand, { KeyId: 'k2' }).resolves({
      KeyMetadata: { KeyId: 'k2', KeyManager: 'CUSTOMER', KeyState: 'Enabled', Origin: 'AWS_KMS', MultiRegionConfiguration: { MultiRegionKeyType: 'REPLICA' } }
    });
    kms.on(DescribeKeyCommand, { KeyId: 'k3' }).resolves({ KeyMetadata: { KeyId: 'k3', KeyManager: 'AWS', KeyState: 'Enabled' } });
    kms.on(DescribeKeyCommand, { KeyId: 'k4' }).resolves({ KeyMetadata: { KeyId: 'k4', KeyManager: 'CUSTOMER', KeyState: 'PendingDeletion' } });
    kms.on(DescribeKeyCommand, { KeyId: 'k5' }).resolves({ KeyMetadata: { KeyId: 'k5', KeyManager: 'CUSTOMER', KeyState: 'PendingReplicaDeletion' } });
    kms.on(DescribeKeyCommand, { KeyId: 'k6' }).resolves({ KeyMetadata: { KeyId: 'k6', KeyManager: 'CUSTOMER', KeyState: 'PendingImport', Origin: 'EXTERNAL' } });
    kms.on(DescribeKeyCommand, { KeyId: 'k7' }).resolves({
      KeyMetadata: { KeyId: 'k7', KeyManager: 'CUSTOMER', KeyState: 'Enabled', Origin: 'EXTERNAL', MultiRegionConfiguration: { MultiRegionKeyType: 'REPLICA' } }
    });

    const service = createService(KMSService, 'kms');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_kms_alias:alias/app',
      'aws_kms_external_key:k6',
      'aws_kms_key:k1',
      'aws_kms_replica_external_key:k7',
      'aws_kms_replica_key:k2'
    ]);
    expect(kms.commandCalls(ListKeysCommand)[1].args[0].input).toMatchObject({ Marker: 'm' });
    expect(service.getResources().find(r => r.id === 'k1')!.name).toBe('app');
    expect(service.getWarnings()).toEqual([]);
  });
});
