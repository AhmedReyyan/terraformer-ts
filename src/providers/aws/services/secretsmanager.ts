import { SecretsManagerClient, paginateListSecrets } from '@aws-sdk/client-secrets-manager';
import { AwsService, tagMap } from '../aws-service';

/**
 * Secrets Manager secrets (metadata only) and their rotation configuration.
 * Secret versions are never imported: they hold the secret values. The resource
 * policy is part of aws_secretsmanager_secret, so aws_secretsmanager_secret_policy
 * is not imported separately.
 */
export class SecretsManagerService extends AwsService {
  async initResources(): Promise<void> {
    const sm = this.client(SecretsManagerClient);

    await this.collect('Secrets Manager secrets', async () => {
      for await (const page of paginateListSecrets({ client: sm }, { IncludePlannedDeletion: false })) {
        for (const secret of page.SecretList || []) {
          if (!secret.ARN || !secret.Name) {
            continue;
          }
          // Skip secrets scheduled for deletion, secrets managed by another service
          // (e.g. RDS master passwords) and replicas (managed by the primary's `replica` block).
          if (secret.DeletedDate || secret.OwningService) {
            continue;
          }
          if (secret.PrimaryRegion && secret.PrimaryRegion !== this.region) {
            continue;
          }
          this.add('aws_secretsmanager_secret', secret.ARN, secret.Name, {
            name: secret.Name,
            arn: secret.ARN,
            tags: tagMap(secret.Tags)
          });
          if (secret.RotationEnabled) {
            this.add('aws_secretsmanager_secret_rotation', secret.ARN, secret.Name, {
              secret_id: secret.ARN
            });
          }
        }
      }
    });
  }
}
