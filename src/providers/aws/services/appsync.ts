import {
  AppSyncClient,
  paginateListGraphqlApis,
  paginateListDataSources,
  paginateListFunctions,
  paginateListTypes,
  paginateListResolvers,
  paginateListDomainNames,
  GetApiCacheCommand,
  GetApiAssociationCommand,
  DomainNameConfig,
  GraphqlApi
} from '@aws-sdk/client-appsync';
import { mapLimit } from '../../../core/provider';
import { AwsService, optional } from '../aws-service';

/**
 * AppSync GraphQL APIs with their data sources, functions, resolvers and caches, plus
 * custom domain names and their API associations.
 *
 * Not imported: aws_appsync_api_key (secret value) and aws_appsync_type (the schema is the
 * `schema` argument of aws_appsync_graphql_api).
 */
export class AppSyncService extends AwsService {
  private appsync!: AppSyncClient;

  async initResources(): Promise<void> {
    this.appsync = this.client(AppSyncClient);
    const apis: GraphqlApi[] = [];

    await this.collect('AppSync GraphQL APIs', async () => {
      for await (const page of paginateListGraphqlApis({ client: this.appsync }, {})) {
        for (const api of page.graphqlApis || []) {
          apis.push(api);
          this.add('aws_appsync_graphql_api', api.apiId!, api.name!, {
            name: api.name, id: api.apiId, arn: api.arn, api_type: api.apiType, tags: api.tags || {}
          });
        }
      }
    });

    // Merged APIs get their data sources, functions and resolvers from the source APIs.
    await mapLimit(apis.filter(api => api.apiType !== 'MERGED'), 3, api => this.loadApi(api));

    const domains: DomainNameConfig[] = [];
    await this.collect('AppSync domain names', async () => {
      for await (const page of paginateListDomainNames({ client: this.appsync }, {})) {
        for (const domain of page.domainNameConfigs || []) {
          domains.push(domain);
          this.add('aws_appsync_domain_name', domain.domainName!, domain.domainName!, {
            domain_name: domain.domainName, arn: domain.domainNameArn, tags: domain.tags || {}
          });
        }
      }
    });

    await mapLimit(domains, 5, domain => this.collect(`AppSync API association of ${domain.domainName}`, async () => {
      const domainName = domain.domainName!;
      const response = await optional(this.appsync.send(new GetApiAssociationCommand({ domainName })));
      const association = response?.apiAssociation;
      if (association?.apiId && association.associationStatus !== 'FAILED') {
        this.add('aws_appsync_domain_name_api_association', domainName, domainName, {
          domain_name: domainName, api_id: association.apiId
        });
      }
    }));
  }

  private async loadApi(api: GraphqlApi): Promise<void> {
    const apiId = api.apiId!;
    const apiName = api.name || apiId;

    await this.collect(`data sources of AppSync API ${apiName}`, async () => {
      for await (const page of paginateListDataSources({ client: this.appsync }, { apiId })) {
        for (const source of page.dataSources || []) {
          this.add('aws_appsync_datasource', `${apiId}-${source.name}`, `${apiName}_${source.name}`, {
            api_id: apiId, name: source.name, type: source.type, arn: source.dataSourceArn
          });
        }
      }
    });

    await this.collect(`functions of AppSync API ${apiName}`, async () => {
      for await (const page of paginateListFunctions({ client: this.appsync }, { apiId })) {
        for (const fn of page.functions || []) {
          this.add('aws_appsync_function', `${apiId}-${fn.functionId}`, `${apiName}_${fn.name}`, {
            api_id: apiId, function_id: fn.functionId, name: fn.name, arn: fn.functionArn
          });
        }
      }
    });

    await this.collect(`resolvers of AppSync API ${apiName}`, async () => {
      const typeNames: string[] = [];
      for await (const page of paginateListTypes({ client: this.appsync }, { apiId, format: 'SDL' })) {
        typeNames.push(...(page.types || []).map(type => type.name!).filter(Boolean));
      }
      await mapLimit(typeNames, 5, async typeName => {
        for await (const page of paginateListResolvers({ client: this.appsync }, { apiId, typeName })) {
          for (const resolver of page.resolvers || []) {
            const type = resolver.typeName || typeName;
            this.add('aws_appsync_resolver', `${apiId}-${type}-${resolver.fieldName}`, `${apiName}_${type}_${resolver.fieldName}`, {
              api_id: apiId, type, field: resolver.fieldName, arn: resolver.resolverArn
            });
          }
        }
      });
    });

    await this.collect(`cache of AppSync API ${apiName}`, async () => {
      const response = await optional(this.appsync.send(new GetApiCacheCommand({ apiId })));
      if (response?.apiCache && response.apiCache.status !== 'DELETING' && response.apiCache.status !== 'FAILED') {
        this.add('aws_appsync_api_cache', apiId, apiName, { api_id: apiId, type: response.apiCache.type });
      }
    });
  }
}
