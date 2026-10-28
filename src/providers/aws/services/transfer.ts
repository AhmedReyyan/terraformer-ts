import {
  TransferClient,
  DescribeUserCommand,
  ListedServer,
  paginateListServers,
  paginateListUsers,
  paginateListAccesses,
  paginateListAgreements,
  paginateListWorkflows,
  paginateListConnectors,
  paginateListProfiles
} from '@aws-sdk/client-transfer';
import { AwsService } from '../aws-service';
import { mapLimit } from '../../../core/provider';

// aws_transfer_certificate is not imported: its configuration contains the private key.
export class TransferService extends AwsService {
  async initResources(): Promise<void> {
    const transfer = this.client(TransferClient);
    const servers: ListedServer[] = [];

    await this.collect('Transfer servers', async () => {
      for await (const page of paginateListServers({ client: transfer }, {})) {
        for (const server of page.Servers || []) {
          if (server.ServerId) {
            servers.push(server);
            this.add('aws_transfer_server', server.ServerId, server.ServerId, { id: server.ServerId, arn: server.Arn });
          }
        }
      }
    });

    await mapLimit(servers, 5, async server => {
      const serverId = server.ServerId as string;

      // Users exist only on servers with service-managed identities; directory-backed servers use accesses.
      if (server.IdentityProviderType === 'SERVICE_MANAGED') {
        await this.collect(`Transfer users of ${serverId}`, async () => {
          const usersWithKeys: string[] = [];
          for await (const page of paginateListUsers({ client: transfer }, { ServerId: serverId })) {
            for (const user of page.Users || []) {
              if (user.UserName) {
                this.add('aws_transfer_user', `${serverId}/${user.UserName}`, `${serverId}-${user.UserName}`, {
                  server_id: serverId, user_name: user.UserName, arn: user.Arn
                });
                if (user.SshPublicKeyCount) {
                  usersWithKeys.push(user.UserName);
                }
              }
            }
          }
          // SSH keys are separate resources (aws_transfer_user has no inline keys) and are public keys, not secrets.
          await mapLimit(usersWithKeys, 5, userName => this.collect(`Transfer SSH keys of ${serverId}/${userName}`, async () => {
            const { User } = await transfer.send(new DescribeUserCommand({ ServerId: serverId, UserName: userName }));
            for (const key of User?.SshPublicKeys || []) {
              if (key.SshPublicKeyId) {
                this.add('aws_transfer_ssh_key', `${serverId}/${userName}/${key.SshPublicKeyId}`,
                  `${serverId}-${userName}-${key.SshPublicKeyId}`, {
                    server_id: serverId, user_name: userName, ssh_public_key_id: key.SshPublicKeyId
                  });
              }
            }
          }));
        });
      }

      if (server.IdentityProviderType === 'AWS_DIRECTORY_SERVICE') {
        await this.collect(`Transfer accesses of ${serverId}`, async () => {
          for await (const page of paginateListAccesses({ client: transfer }, { ServerId: serverId })) {
            for (const access of page.Accesses || []) {
              if (access.ExternalId) {
                this.add('aws_transfer_access', `${serverId}/${access.ExternalId}`, `${serverId}-${access.ExternalId}`, {
                  server_id: serverId, external_id: access.ExternalId
                });
              }
            }
          }
        });
      }

      await this.collect(`Transfer agreements of ${serverId}`, async () => {
        for await (const page of paginateListAgreements({ client: transfer }, { ServerId: serverId })) {
          for (const agreement of page.Agreements || []) {
            if (agreement.AgreementId) {
              this.add('aws_transfer_agreement', `${serverId}/${agreement.AgreementId}`, `${serverId}-${agreement.AgreementId}`, {
                server_id: serverId, agreement_id: agreement.AgreementId, arn: agreement.Arn
              });
            }
          }
        }
      });
    });

    await this.collect('Transfer workflows', async () => {
      for await (const page of paginateListWorkflows({ client: transfer }, {})) {
        for (const workflow of page.Workflows || []) {
          if (workflow.WorkflowId) {
            this.add('aws_transfer_workflow', workflow.WorkflowId, workflow.WorkflowId, { id: workflow.WorkflowId, arn: workflow.Arn });
          }
        }
      }
    });

    await this.collect('Transfer connectors', async () => {
      for await (const page of paginateListConnectors({ client: transfer }, {})) {
        for (const connector of page.Connectors || []) {
          if (connector.ConnectorId) {
            this.add('aws_transfer_connector', connector.ConnectorId, connector.ConnectorId, {
              id: connector.ConnectorId, arn: connector.Arn, url: connector.Url
            });
          }
        }
      }
    });

    await this.collect('Transfer profiles', async () => {
      for await (const page of paginateListProfiles({ client: transfer }, {})) {
        for (const profile of page.Profiles || []) {
          if (profile.ProfileId) {
            this.add('aws_transfer_profile', profile.ProfileId, profile.As2Id || profile.ProfileId, {
              id: profile.ProfileId, arn: profile.Arn, as2_id: profile.As2Id
            });
          }
        }
      }
    });
  }
}
