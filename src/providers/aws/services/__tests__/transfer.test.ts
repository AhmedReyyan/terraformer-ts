import { mockClient } from 'aws-sdk-client-mock';
import {
  TransferClient,
  ListServersCommand,
  ListUsersCommand,
  DescribeUserCommand,
  ListAccessesCommand,
  ListAgreementsCommand,
  ListWorkflowsCommand,
  ListConnectorsCommand,
  ListProfilesCommand
} from '@aws-sdk/client-transfer';
import { TransferService } from '../transfer';
import { createService, importIds } from './helpers';

const transfer = mockClient(TransferClient);
const now = new Date();

beforeEach(() => {
  transfer.reset();
  transfer.on(ListServersCommand).resolves({ Servers: [] });
  transfer.on(ListAgreementsCommand).resolves({ Agreements: [] });
  transfer.on(ListWorkflowsCommand).resolves({ Workflows: [] });
  transfer.on(ListConnectorsCommand).resolves({ Connectors: [] });
  transfer.on(ListProfilesCommand).resolves({ Profiles: [] });
});

describe('TransferService', () => {
  it('imports servers with their users, SSH keys, accesses and agreements, plus account-level resources', async () => {
    transfer.on(ListServersCommand)
      .resolvesOnce({ Servers: [{ ServerId: 's-1111', Arn: 'arn:s1', IdentityProviderType: 'SERVICE_MANAGED' }], NextToken: 'p2' })
      .resolvesOnce({ Servers: [{ ServerId: 's-2222', Arn: 'arn:s2', IdentityProviderType: 'AWS_DIRECTORY_SERVICE' }] });
    transfer.on(ListUsersCommand, { ServerId: 's-1111' }).resolves({
      ServerId: 's-1111',
      Users: [
        { UserName: 'alice', Arn: 'arn:u1', SshPublicKeyCount: 1 },
        { UserName: 'bob', Arn: 'arn:u2', SshPublicKeyCount: 0 }
      ]
    });
    transfer.on(DescribeUserCommand, { ServerId: 's-1111', UserName: 'alice' }).resolves({
      ServerId: 's-1111',
      User: { Arn: 'arn:u1', UserName: 'alice', SshPublicKeys: [{ SshPublicKeyId: 'key-123', SshPublicKeyBody: 'ssh-rsa AAA', DateImported: now }] }
    });
    transfer.on(ListAccessesCommand, { ServerId: 's-2222' }).resolves({
      ServerId: 's-2222', Accesses: [{ ExternalId: 'S-1-1-12-1234' }]
    });
    transfer.on(ListAgreementsCommand, { ServerId: 's-1111' }).resolves({ Agreements: [{ AgreementId: 'a-1', ServerId: 's-1111' }] });
    transfer.on(ListWorkflowsCommand).resolves({ Workflows: [{ WorkflowId: 'w-1' }] });
    transfer.on(ListConnectorsCommand).resolves({ Connectors: [{ ConnectorId: 'c-1' }] });
    transfer.on(ListProfilesCommand).resolves({ Profiles: [{ ProfileId: 'p-1', As2Id: 'partner' }] });

    const service = createService(TransferService, 'transfer');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_transfer_access:s-2222/S-1-1-12-1234',
      'aws_transfer_agreement:s-1111/a-1',
      'aws_transfer_connector:c-1',
      'aws_transfer_profile:p-1',
      'aws_transfer_server:s-1111',
      'aws_transfer_server:s-2222',
      'aws_transfer_ssh_key:s-1111/alice/key-123',
      'aws_transfer_user:s-1111/alice',
      'aws_transfer_user:s-1111/bob',
      'aws_transfer_workflow:w-1'
    ]);
    expect(transfer.commandCalls(ListServersCommand)[1].args[0].input).toMatchObject({ NextToken: 'p2' });
    // Users are only listed on service-managed servers, accesses only on directory-backed ones,
    // and DescribeUser only for users that have keys.
    expect(transfer.commandCalls(ListUsersCommand).map(c => c.args[0].input.ServerId)).toEqual(['s-1111']);
    expect(transfer.commandCalls(ListAccessesCommand).map(c => c.args[0].input.ServerId)).toEqual(['s-2222']);
    expect(transfer.commandCalls(DescribeUserCommand).map(c => c.args[0].input.UserName)).toEqual(['alice']);
    expect(service.getWarnings()).toEqual([]);
    // Public key material is never stored as metadata.
    expect(JSON.stringify(service.getResources())).not.toContain('ssh-rsa');
  });
});
