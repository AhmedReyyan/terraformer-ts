import { mockClient } from 'aws-sdk-client-mock';
import {
  CognitoIdentityProviderClient,
  ListUserPoolsCommand,
  DescribeUserPoolCommand,
  ListUserPoolClientsCommand,
  ListIdentityProvidersCommand,
  ListResourceServersCommand,
  ListGroupsCommand
} from '@aws-sdk/client-cognito-identity-provider';
import { CognitoIdentityClient, ListIdentityPoolsCommand, GetIdentityPoolRolesCommand } from '@aws-sdk/client-cognito-identity';
import { CognitoService } from '../cognito';
import { createService, importIds } from './helpers';

const idp = mockClient(CognitoIdentityProviderClient);
const identity = mockClient(CognitoIdentityClient);

beforeEach(() => {
  idp.reset();
  identity.reset();
});

describe('CognitoService', () => {
  it('imports user pools with children and identity pools', async () => {
    idp.on(ListUserPoolsCommand)
      .resolvesOnce({ UserPools: [{ Id: 'us-east-1_A', Name: 'a' }], NextToken: 'n' })
      .resolves({ UserPools: [{ Id: 'us-east-1_B', Name: 'b' }] });
    idp.on(DescribeUserPoolCommand, { UserPoolId: 'us-east-1_A' }).resolves({ UserPool: { Domain: 'my-prefix', CustomDomain: 'auth.example.org' } });
    idp.on(DescribeUserPoolCommand, { UserPoolId: 'us-east-1_B' }).resolves({ UserPool: {} });
    idp.on(ListUserPoolClientsCommand).resolves({ UserPoolClients: [] });
    idp.on(ListUserPoolClientsCommand, { UserPoolId: 'us-east-1_A' }).resolves({ UserPoolClients: [{ ClientId: 'c1', ClientName: 'web' }] });
    idp.on(ListIdentityProvidersCommand).resolves({ Providers: [] });
    idp.on(ListIdentityProvidersCommand, { UserPoolId: 'us-east-1_A' }).resolves({ Providers: [{ ProviderName: 'CorpAD', ProviderType: 'SAML' }] });
    idp.on(ListResourceServersCommand).resolves({ ResourceServers: [] });
    idp.on(ListResourceServersCommand, { UserPoolId: 'us-east-1_A' }).resolves({ ResourceServers: [{ Identifier: 'https://api.example.com', Name: 'api' }] });
    idp.on(ListGroupsCommand).resolves({ Groups: [] });
    idp.on(ListGroupsCommand, { UserPoolId: 'us-east-1_B' }).resolves({ Groups: [{ GroupName: 'admins' }] });

    identity.on(ListIdentityPoolsCommand).resolves({
      IdentityPools: [
        { IdentityPoolId: 'us-east-1:p1', IdentityPoolName: 'with_roles' },
        { IdentityPoolId: 'us-east-1:p2', IdentityPoolName: 'no_roles' }
      ]
    });
    identity.on(GetIdentityPoolRolesCommand, { IdentityPoolId: 'us-east-1:p1' }).resolves({ Roles: { authenticated: 'arn:role' } });
    identity.on(GetIdentityPoolRolesCommand, { IdentityPoolId: 'us-east-1:p2' }).resolves({});

    const service = createService(CognitoService, 'cognito');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_cognito_identity_pool:us-east-1:p1',
      'aws_cognito_identity_pool:us-east-1:p2',
      'aws_cognito_identity_pool_roles_attachment:us-east-1:p1',
      'aws_cognito_identity_provider:us-east-1_A:CorpAD',
      'aws_cognito_resource_server:us-east-1_A|https://api.example.com',
      'aws_cognito_user_group:us-east-1_B/admins',
      'aws_cognito_user_pool:us-east-1_A',
      'aws_cognito_user_pool:us-east-1_B',
      'aws_cognito_user_pool_client:us-east-1_A/c1',
      'aws_cognito_user_pool_domain:auth.example.org',
      'aws_cognito_user_pool_domain:my-prefix'
    ]);
    expect(idp.commandCalls(ListUserPoolsCommand)[1].args[0].input).toMatchObject({ NextToken: 'n', MaxResults: 60 });
    expect(service.getWarnings()).toEqual([]);
  });
});
