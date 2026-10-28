import {
  ApiGatewayV2Client,
  GetApisCommand,
  GetStagesCommand,
  GetRoutesCommand,
  GetIntegrationsCommand,
  GetAuthorizersCommand,
  GetDomainNamesCommand,
  GetApiMappingsCommand,
  GetVpcLinksCommand,
  Api,
  ApiMapping,
  DomainName
} from '@aws-sdk/client-apigatewayv2';
import { mapLimit } from '../../../core/provider';
import { AwsService } from '../aws-service';

/** Iterate the pages of a NextToken-paginated API (client-apigatewayv2 ships no paginators for these). */
async function* pages<T extends { NextToken?: string }>(fetch: (token?: string) => Promise<T>): AsyncGenerator<T> {
  let token: string | undefined;
  do {
    const page = await fetch(token);
    yield page;
    token = page.NextToken;
  } while (token);
}

/**
 * API Gateway v2 (HTTP and WebSocket APIs) with their stages, deployments, routes,
 * integrations and authorizers, plus custom domain names, API mappings and VPC links.
 *
 * Objects with `ApiGatewayManaged: true` (created by quick create) cannot be imported and are skipped.
 */
export class APIGatewayV2Service extends AwsService {
  private apigw!: ApiGatewayV2Client;
  private apiIds = new Set<string>();
  private apisListed = false;

  async initResources(): Promise<void> {
    this.apigw = this.client(ApiGatewayV2Client);
    const apis: Api[] = [];

    await this.collect('API Gateway v2 APIs', async () => {
      for await (const page of pages(NextToken => this.apigw.send(new GetApisCommand({ NextToken })))) {
        for (const api of page.Items || []) {
          this.apiIds.add(api.ApiId!);
          if (api.ApiGatewayManaged) {
            continue;
          }
          apis.push(api);
          this.add('aws_apigatewayv2_api', api.ApiId!, api.Name!, {
            name: api.Name, id: api.ApiId, protocol_type: api.ProtocolType, tags: api.Tags || {}
          });
        }
      }
      this.apisListed = true;
    });

    await mapLimit(apis, 3, api => this.loadApi(api));

    await this.loadDomainNames();

    await this.collect('API Gateway v2 VPC links', async () => {
      for await (const page of pages(NextToken => this.apigw.send(new GetVpcLinksCommand({ NextToken })))) {
        for (const link of page.Items || []) {
          if (link.VpcLinkStatus === 'DELETING' || link.VpcLinkStatus === 'FAILED') {
            continue;
          }
          this.add('aws_apigatewayv2_vpc_link', link.VpcLinkId!, link.Name!, {
            name: link.Name, id: link.VpcLinkId, tags: link.Tags || {}
          });
        }
      }
    });
  }

  private async loadApi(api: Api): Promise<void> {
    const ApiId = api.ApiId!;
    const apiName = api.Name || ApiId;

    await this.collect(`stages of API ${apiName}`, async () => {
      const deploymentIds = new Set<string>();
      for await (const page of pages(NextToken => this.apigw.send(new GetStagesCommand({ ApiId, NextToken })))) {
        for (const stage of page.Items || []) {
          if (stage.ApiGatewayManaged) {
            continue;
          }
          this.add('aws_apigatewayv2_stage', `${ApiId}/${stage.StageName}`, `${apiName}_${stage.StageName}`, {
            api_id: ApiId, name: stage.StageName, tags: stage.Tags || {}
          });
          // Auto-deploy stages create their own deployments; only explicit deployments are configuration.
          if (stage.DeploymentId && !stage.AutoDeploy) {
            deploymentIds.add(stage.DeploymentId);
          }
        }
      }
      for (const deploymentId of deploymentIds) {
        this.add('aws_apigatewayv2_deployment', `${ApiId}/${deploymentId}`, `${apiName}_${deploymentId}`, {
          api_id: ApiId, id: deploymentId
        });
      }
    });

    await this.collect(`routes of API ${apiName}`, async () => {
      for await (const page of pages(NextToken => this.apigw.send(new GetRoutesCommand({ ApiId, NextToken })))) {
        for (const route of page.Items || []) {
          if (route.ApiGatewayManaged) {
            continue;
          }
          this.add('aws_apigatewayv2_route', `${ApiId}/${route.RouteId}`, `${apiName}_${route.RouteKey}`, {
            api_id: ApiId, id: route.RouteId, route_key: route.RouteKey
          });
        }
      }
    });

    await this.collect(`integrations of API ${apiName}`, async () => {
      for await (const page of pages(NextToken => this.apigw.send(new GetIntegrationsCommand({ ApiId, NextToken })))) {
        for (const integration of page.Items || []) {
          if (integration.ApiGatewayManaged) {
            continue;
          }
          this.add('aws_apigatewayv2_integration', `${ApiId}/${integration.IntegrationId}`, `${apiName}_${integration.IntegrationId}`, {
            api_id: ApiId, id: integration.IntegrationId, integration_type: integration.IntegrationType
          });
        }
      }
    });

    await this.collect(`authorizers of API ${apiName}`, async () => {
      for await (const page of pages(NextToken => this.apigw.send(new GetAuthorizersCommand({ ApiId, NextToken })))) {
        for (const authorizer of page.Items || []) {
          this.add('aws_apigatewayv2_authorizer', `${ApiId}/${authorizer.AuthorizerId}`, `${apiName}_${authorizer.Name}`, {
            api_id: ApiId, id: authorizer.AuthorizerId, name: authorizer.Name
          });
        }
      }
    });
  }

  private async loadDomainNames(): Promise<void> {
    const domains: DomainName[] = [];
    await this.collect('API Gateway v2 domain names', async () => {
      for await (const page of pages(NextToken => this.apigw.send(new GetDomainNamesCommand({ NextToken })))) {
        domains.push(...(page.Items || []));
      }
    });

    await mapLimit(domains, 5, domain => this.collect(`API mappings of ${domain.DomainName}`, async () => {
      const DomainName = domain.DomainName!;
      const mappings: ApiMapping[] = [];
      for await (const page of pages(NextToken => this.apigw.send(new GetApiMappingsCommand({ DomainName, NextToken })))) {
        mappings.push(...(page.Items || []));
      }
      // Mappings to REST APIs are aws_api_gateway_base_path_mapping (api_gateway service).
      const v2Mappings = mappings.filter(mapping => this.apiIds.has(mapping.ApiId!));

      // Custom domain names are shared with API Gateway v1. This service owns a domain only when all of
      // its mappings point to HTTP/WebSocket APIs; otherwise the api_gateway service imports it.
      if (this.apisListed && mappings.length > 0 && v2Mappings.length === mappings.length) {
        this.add('aws_apigatewayv2_domain_name', DomainName, DomainName, {
          domain_name: DomainName, arn: domain.DomainNameArn, tags: domain.Tags || {}
        });
      }

      for (const mapping of v2Mappings) {
        this.add('aws_apigatewayv2_api_mapping', `${mapping.ApiMappingId}/${DomainName}`,
          `${DomainName}_${mapping.ApiMappingKey || 'root'}`, {
            domain_name: DomainName, id: mapping.ApiMappingId, api_id: mapping.ApiId, stage: mapping.Stage,
            api_mapping_key: mapping.ApiMappingKey
          });
      }
    }));
  }
}
