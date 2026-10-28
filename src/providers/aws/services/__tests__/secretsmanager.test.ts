import { mockClient } from 'aws-sdk-client-mock';
import { SecretsManagerClient, ListSecretsCommand } from '@aws-sdk/client-secrets-manager';
import { SecretsManagerService } from '../secretsmanager';
import { createService, importIds } from './helpers';

const sm = mockClient(SecretsManagerClient);

beforeEach(() => sm.reset());

const arn = (name: string) => `arn:aws:secretsmanager:eu-west-1:123456789012:secret:${name}-AbCdEf`;

describe('SecretsManagerService', () => {
  it('imports secrets and rotations, skipping deleted, service-owned and replica secrets', async () => {
    sm.on(ListSecretsCommand)
      .resolvesOnce({
        SecretList: [
          { ARN: arn('app'), Name: 'app', RotationEnabled: true, Tags: [{ Key: 'env', Value: 'prod' }] },
          { ARN: arn('deleted'), Name: 'deleted', DeletedDate: new Date() }
        ],
        NextToken: 't'
      })
      .resolves({
        SecretList: [
          { ARN: arn('plain'), Name: 'plain', PrimaryRegion: 'eu-west-1' },
          { ARN: arn('rds'), Name: 'rds!db-1', OwningService: 'rds', RotationEnabled: true },
          { ARN: arn('replica'), Name: 'replica', PrimaryRegion: 'us-east-1' }
        ]
      });

    const service = createService(SecretsManagerService, 'secretsmanager', 'eu-west-1');
    await service.initResources();

    expect(importIds(service)).toEqual([
      `aws_secretsmanager_secret:${arn('app')}`,
      `aws_secretsmanager_secret:${arn('plain')}`,
      `aws_secretsmanager_secret_rotation:${arn('app')}`
    ]);
    expect(sm.commandCalls(ListSecretsCommand)[1].args[0].input).toMatchObject({ NextToken: 't' });
    expect(service.getResources()[0].attributes.tags).toEqual({ env: 'prod' });
  });
});
