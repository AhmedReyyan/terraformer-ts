import {
  CognitoIdentityProviderClient,
  paginateListUserPools,
  paginateListUserPoolClients,
  paginateListIdentityProviders,
  paginateListResourceServers,
  paginateListGroups,
  DescribeUserPoolCommand
} from '@aws-sdk/client-cognito-identity-provider';
import {
  CognitoIdentityClient,
  paginateListIdentityPools,
  GetIdentityPoolRolesCommand
} from '@aws-sdk/client-cognito-identity';
import { mapLimit } from '../../../core/provider';
import { AwsService } from '../aws-service';

/** Cognito user pools (with clients, domains, IdPs, resource servers, groups) and identity pools. */
export class CognitoService extends AwsService {
  async initResources(): Promise<void> {
    await this.collect('Cognito user pools', () => this.loadUserPools());
    await this.collect('Cognito identity pools', () => this.loadIdentityPools());
  }

  private async loadUserPools(): Promise<void> {
    const idp = this.client(CognitoIdentityProviderClient);
    const pools: Array<{ id: string; name: string }> = [];
    for await (const page of paginateListUserPools({ client: idp }, { MaxResults: 60 })) {
      for (const pool of page.UserPools || []) {
        if (pool.Id) {
          pools.push({ id: pool.Id, name: pool.Name || pool.Id });
          this.add('aws_cognito_user_pool', pool.Id, pool.Name || pool.Id, { id: pool.Id, name: pool.Name });
        }
      }
    }

    await mapLimit(pools, 5, async ({ id, name }) => {
      await this.collect(`Cognito user pool ${id} domains`, async () => {
        const { UserPool: pool } = await idp.send(new DescribeUserPoolCommand({ UserPoolId: id }));
        // Domain is the Cognito prefix domain, CustomDomain a custom FQDN; both import by the domain.
        for (const domain of [pool?.Domain, pool?.CustomDomain]) {
          if (domain) {
            this.add('aws_cognito_user_pool_domain', domain, domain, { domain, user_pool_id: id });
          }
        }
      });

      await this.collect(`Cognito user pool ${id} clients`, async () => {
        for await (const page of paginateListUserPoolClients({ client: idp }, { UserPoolId: id, MaxResults: 60 })) {
          for (const client of page.UserPoolClients || []) {
            if (client.ClientId) {
              this.add('aws_cognito_user_pool_client', `${id}/${client.ClientId}`,
                `${name}-${client.ClientName || client.ClientId}`,
                { id: client.ClientId, name: client.ClientName, user_pool_id: id });
            }
          }
        }
      });

      await this.collect(`Cognito user pool ${id} identity providers`, async () => {
        for await (const page of paginateListIdentityProviders({ client: idp }, { UserPoolId: id, MaxResults: 60 })) {
          for (const provider of page.Providers || []) {
            if (provider.ProviderName) {
              this.add('aws_cognito_identity_provider', `${id}:${provider.ProviderName}`,
                `${name}-${provider.ProviderName}`,
                { provider_name: provider.ProviderName, provider_type: provider.ProviderType, user_pool_id: id });
            }
          }
        }
      });

      await this.collect(`Cognito user pool ${id} resource servers`, async () => {
        for await (const page of paginateListResourceServers({ client: idp }, { UserPoolId: id, MaxResults: 50 })) {
          for (const server of page.ResourceServers || []) {
            if (server.Identifier) {
              this.add('aws_cognito_resource_server', `${id}|${server.Identifier}`,
                `${name}-${server.Name || server.Identifier}`,
                { identifier: server.Identifier, name: server.Name, user_pool_id: id });
            }
          }
        }
      });

      await this.collect(`Cognito user pool ${id} groups`, async () => {
        for await (const page of paginateListGroups({ client: idp }, { UserPoolId: id, Limit: 60 })) {
          for (const group of page.Groups || []) {
            if (group.GroupName) {
              this.add('aws_cognito_user_group', `${id}/${group.GroupName}`, `${name}-${group.GroupName}`,
                { name: group.GroupName, user_pool_id: id });
            }
          }
        }
      });
    });
  }

  private async loadIdentityPools(): Promise<void> {
    const identity = this.client(CognitoIdentityClient);
    const pools: Array<{ id: string; name: string }> = [];
    for await (const page of paginateListIdentityPools({ client: identity }, { MaxResults: 60 })) {
      for (const pool of page.IdentityPools || []) {
        if (pool.IdentityPoolId) {
          const name = pool.IdentityPoolName || pool.IdentityPoolId;
          pools.push({ id: pool.IdentityPoolId, name });
          this.add('aws_cognito_identity_pool', pool.IdentityPoolId, name, {
            id: pool.IdentityPoolId,
            name: pool.IdentityPoolName
          });
        }
      }
    }

    // Roles are not part of aws_cognito_identity_pool; import the attachment when roles are set.
    await mapLimit(pools, 5, ({ id, name }) => this.collect(`Cognito identity pool ${id} roles`, async () => {
      const roles = await identity.send(new GetIdentityPoolRolesCommand({ IdentityPoolId: id }));
      if (Object.keys(roles.Roles || {}).length || Object.keys(roles.RoleMappings || {}).length) {
        this.add('aws_cognito_identity_pool_roles_attachment', id, name, { identity_pool_id: id });
      }
    }));
  }
}
