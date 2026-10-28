import { mockClient } from 'aws-sdk-client-mock';
import {
  AppSyncClient,
  ListGraphqlApisCommand,
  ListDataSourcesCommand,
  ListFunctionsCommand,
  ListTypesCommand,
  ListResolversCommand,
  ListDomainNamesCommand,
  GetApiCacheCommand,
  GetApiAssociationCommand
} from '@aws-sdk/client-appsync';
import { AppSyncService } from '../appsync';
import { createService, importIds, notFound } from './helpers';

const appsync = mockClient(AppSyncClient);

beforeEach(() => {
  appsync.reset();
  appsync.on(ListGraphqlApisCommand).resolves({});
  appsync.on(ListDataSourcesCommand).resolves({});
  appsync.on(ListFunctionsCommand).resolves({});
  appsync.on(ListTypesCommand).resolves({});
  appsync.on(ListResolversCommand).resolves({});
  appsync.on(ListDomainNamesCommand).resolves({});
  appsync.on(GetApiCacheCommand).rejects(notFound('NotFoundException'));
  appsync.on(GetApiAssociationCommand).rejects(notFound('NotFoundException'));
});

describe('AppSyncService', () => {
  it('imports GraphQL APIs with data sources, functions, resolvers and cache', async () => {
    appsync.on(ListGraphqlApisCommand)
      .resolvesOnce({ graphqlApis: [{ apiId: 'api1', name: 'shop', apiType: 'GRAPHQL' }], nextToken: 'n2' })
      .resolvesOnce({ graphqlApis: [{ apiId: 'merged1', name: 'merged', apiType: 'MERGED' }] });
    appsync.on(ListDataSourcesCommand, { apiId: 'api1' }).resolves({ dataSources: [{ name: 'orders_table', type: 'AMAZON_DYNAMODB' }] });
    appsync.on(ListFunctionsCommand, { apiId: 'api1' }).resolves({ functions: [{ functionId: 'fn1', name: 'auth' }] });
    appsync.on(ListTypesCommand, { apiId: 'api1' }).resolves({ types: [{ name: 'Query' }, { name: 'Order' }] });
    appsync.on(ListResolversCommand, { apiId: 'api1', typeName: 'Query' })
      .resolvesOnce({ resolvers: [{ typeName: 'Query', fieldName: 'getOrder' }], nextToken: 'q2' })
      .resolvesOnce({ resolvers: [{ typeName: 'Query', fieldName: 'listOrders' }] });
    appsync.on(GetApiCacheCommand, { apiId: 'api1' }).resolves({ apiCache: { type: 'SMALL', status: 'AVAILABLE' } });

    const service = createService(AppSyncService, 'appsync');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_appsync_api_cache:api1',
      'aws_appsync_datasource:api1-orders_table',
      'aws_appsync_function:api1-fn1',
      'aws_appsync_graphql_api:api1',
      'aws_appsync_graphql_api:merged1',
      'aws_appsync_resolver:api1-Query-getOrder',
      'aws_appsync_resolver:api1-Query-listOrders'
    ]);
    expect(appsync.commandCalls(ListTypesCommand)[0].args[0].input).toMatchObject({ format: 'SDL' });
    expect(appsync.commandCalls(ListDataSourcesCommand, { apiId: 'merged1' })).toHaveLength(0);
    expect(service.getWarnings()).toEqual([]);
  });

  it('imports domain names and their API association', async () => {
    appsync.on(ListDomainNamesCommand).resolves({
      domainNameConfigs: [{ domainName: 'gql.example.com' }, { domainName: 'free.example.com' }]
    });
    appsync.on(GetApiAssociationCommand, { domainName: 'gql.example.com' }).resolves({
      apiAssociation: { domainName: 'gql.example.com', apiId: 'api1', associationStatus: 'SUCCESS' }
    });

    const service = createService(AppSyncService, 'appsync');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_appsync_domain_name:free.example.com',
      'aws_appsync_domain_name:gql.example.com',
      'aws_appsync_domain_name_api_association:gql.example.com'
    ]);
    expect(service.getWarnings()).toEqual([]);
  });
});
