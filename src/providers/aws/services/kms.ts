import { KMSClient, paginateListKeys, paginateListAliases, DescribeKeyCommand, KeyMetadata } from '@aws-sdk/client-kms';
import { mapLimit } from '../../../core/provider';
import { AwsService } from '../aws-service';

/** Key states that mean the key is going away. */
const DELETING_STATES = new Set(['PendingDeletion', 'PendingReplicaDeletion']);

/**
 * Customer managed KMS keys and their aliases. The key policy is part of the key
 * resources, so aws_kms_key_policy is not imported separately.
 */
export class KMSService extends AwsService {
  async initResources(): Promise<void> {
    const kms = this.client(KMSClient);
    const aliasesByKey = new Map<string, string>();

    await this.collect('KMS aliases', async () => {
      for await (const page of paginateListAliases({ client: kms }, {})) {
        for (const alias of page.Aliases || []) {
          // alias/aws/* are AWS managed; aliases without a target are reserved AWS names.
          if (!alias.AliasName || !alias.TargetKeyId || alias.AliasName.startsWith('alias/aws/')) {
            continue;
          }
          if (!aliasesByKey.has(alias.TargetKeyId)) {
            aliasesByKey.set(alias.TargetKeyId, alias.AliasName.slice('alias/'.length));
          }
          this.add('aws_kms_alias', alias.AliasName, alias.AliasName.slice('alias/'.length), {
            name: alias.AliasName,
            arn: alias.AliasArn,
            target_key_id: alias.TargetKeyId
          });
        }
      }
    });

    await this.collect('KMS keys', async () => {
      const keyIds: string[] = [];
      for await (const page of paginateListKeys({ client: kms }, {})) {
        for (const key of page.Keys || []) {
          if (key.KeyId) {
            keyIds.push(key.KeyId);
          }
        }
      }
      await mapLimit(keyIds, 5, keyId => this.collect(`KMS key ${keyId}`, async () => {
        const { KeyMetadata: key } = await kms.send(new DescribeKeyCommand({ KeyId: keyId }));
        if (key) {
          this.addKey(key, aliasesByKey.get(keyId) || keyId);
        }
      }));
    });
  }

  private addKey(key: KeyMetadata, name: string): void {
    // AWS managed keys and keys scheduled for deletion are skipped.
    if (key.KeyManager !== 'CUSTOMER' || DELETING_STATES.has(key.KeyState || '')) {
      return;
    }
    const replica = key.MultiRegionConfiguration?.MultiRegionKeyType === 'REPLICA';
    const attributes = { key_id: key.KeyId, arn: key.Arn, description: key.Description, key_state: key.KeyState };
    // Imported key material (Origin EXTERNAL) has its own resource types.
    if (key.Origin === 'EXTERNAL') {
      if (replica) {
        this.add('aws_kms_replica_external_key', key.KeyId!, name, attributes);
      } else {
        this.add('aws_kms_external_key', key.KeyId!, name, attributes);
      }
    } else if (replica) {
      this.add('aws_kms_replica_key', key.KeyId!, name, attributes);
    } else {
      this.add('aws_kms_key', key.KeyId!, name, attributes);
    }
  }
}
