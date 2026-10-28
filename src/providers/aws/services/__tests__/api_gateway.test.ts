import { mockClient } from 'aws-sdk-client-mock';
import {
  APIGatewayClient,
  GetRestApisCommand,
  GetResourcesCommand,
  GetStagesCommand,
  GetAuthorizersCommand,
  GetModelsCommand,
  GetRequestValidatorsCommand,
  GetGatewayResponsesCommand,
  GetUsagePlansCommand,
  GetUsagePlanKeysCommand,
  GetDomainNamesCommand,
  GetBasePathMappingsCommand,
  GetVpcLinksCommand
} from '@aws-sdk/client-api-gateway';
import { APIGatewayService } from '../api_gateway';
import { createService, importIds } from './helpers';

const apigw = mockClient(APIGatewayClient);

beforeEach(() => {
  apigw.reset();
  for (const command of [
    GetRestApisCommand, GetResourcesCommand, GetAuthorizersCommand, GetModelsCommand, GetRequestValidatorsCommand,
    GetGatewayResponsesCommand, GetUsagePlansCommand, GetUsagePlanKeysCommand, GetDomainNamesCommand,
    GetBasePathMappingsCommand, GetVpcLinksCommand
  ]) {
    apigw.on(command as any).resolves({ items: [] });
  }
  apigw.on(GetStagesCommand).resolves({ item: [] });
});

describe('APIGatewayService', () => {
  it('imports a REST API with resources, methods, integrations and their responses', async () => {
    apigw.on(GetRestApisCommand)
      .resolvesOnce({ items: [{ id: 'api1', name: 'shop' }], position: 'p2' })
      .resolvesOnce({ items: [] });
    apigw.on(GetResourcesCommand, { restApiId: 'api1' })
      .resolvesOnce({
        items: [{
          id: 'root', path: '/',
          resourceMethods: { GET: { httpMethod: 'GET', methodResponses: { '200': {} } } }
        }],
        position: 'r2'
      })
      .resolvesOnce({
        items: [{
          id: 'res1', parentId: 'root', path: '/orders',
          resourceMethods: {
            POST: {
              httpMethod: 'POST',
              methodResponses: { '201': {} },
              methodIntegration: { type: 'AWS_PROXY', integrationResponses: { '201': {} } }
            }
          }
        }]
      });

    const service = createService(APIGatewayService, 'api_gateway');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_api_gateway_integration:api1/res1/POST',
      'aws_api_gateway_integration_response:api1/res1/POST/201',
      'aws_api_gateway_method:api1/res1/POST',
      'aws_api_gateway_method:api1/root/GET',
      'aws_api_gateway_method_response:api1/res1/POST/201',
      'aws_api_gateway_method_response:api1/root/GET/200',
      'aws_api_gateway_resource:api1/res1',
      'aws_api_gateway_rest_api:api1'
    ]);
    expect(apigw.commandCalls(GetResourcesCommand)[0].args[0].input).toMatchObject({ embed: ['methods'] });
    expect(apigw.commandCalls(GetResourcesCommand)[1].args[0].input).toMatchObject({ position: 'r2' });
    expect(service.getWarnings()).toEqual([]);
  });

  it('imports stages, method settings, active deployments, authorizers, models, validators and custom gateway responses', async () => {
    apigw.on(GetRestApisCommand).resolves({ items: [{ id: 'api1', name: 'shop' }] });
    apigw.on(GetStagesCommand).resolves({
      item: [
        { stageName: 'prod', deploymentId: 'd1', methodSettings: { '*/*': {}, 'orders/GET': {} } },
        { stageName: 'dev', deploymentId: 'd1' }
      ]
    });
    apigw.on(GetAuthorizersCommand)
      .resolvesOnce({ items: [{ id: 'au1', name: 'jwt' }], position: 'a2' })
      .resolvesOnce({ items: [{ id: 'au2', name: 'lambda' }] });
    apigw.on(GetModelsCommand).resolves({ items: [{ name: 'Empty' }, { name: 'Error' }, { name: 'Order' }] });
    apigw.on(GetRequestValidatorsCommand).resolves({ items: [{ id: 'v1', name: 'body' }] });
    apigw.on(GetGatewayResponsesCommand).resolves({
      items: [
        { responseType: 'DEFAULT_4XX', defaultResponse: true },
        { responseType: 'UNAUTHORIZED', defaultResponse: false }
      ]
    });

    const service = createService(APIGatewayService, 'api_gateway');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_api_gateway_authorizer:api1/au1',
      'aws_api_gateway_authorizer:api1/au2',
      'aws_api_gateway_deployment:api1/d1',
      'aws_api_gateway_gateway_response:api1/UNAUTHORIZED',
      'aws_api_gateway_method_settings:api1/prod/*/*',
      'aws_api_gateway_method_settings:api1/prod/orders/GET',
      'aws_api_gateway_model:api1/Order',
      'aws_api_gateway_request_validator:api1/v1',
      'aws_api_gateway_rest_api:api1',
      'aws_api_gateway_stage:api1/dev',
      'aws_api_gateway_stage:api1/prod'
    ]);
    expect(apigw.commandCalls(GetAuthorizersCommand)[1].args[0].input).toMatchObject({ position: 'a2' });
  });

  it('imports usage plans with keys, VPC links, domain names and base path mappings', async () => {
    apigw.on(GetRestApisCommand).resolves({ items: [{ id: 'api1', name: 'shop' }] });
    apigw.on(GetUsagePlansCommand).resolves({ items: [{ id: 'up1', name: 'gold' }] });
    apigw.on(GetUsagePlanKeysCommand, { usagePlanId: 'up1' }).resolves({ items: [{ id: 'k1', name: 'partner', type: 'API_KEY' }] });
    apigw.on(GetVpcLinksCommand).resolves({
      items: [{ id: 'vl1', name: 'nlb', status: 'AVAILABLE' }, { id: 'vl2', name: 'bad', status: 'FAILED' }]
    });
    apigw.on(GetDomainNamesCommand).resolves({
      items: [
        { domainName: 'api.example.com', endpointConfiguration: { types: ['EDGE'] } },
        { domainName: 'private.example.com', domainNameId: 'abc123', endpointConfiguration: { types: ['PRIVATE'] } },
        { domainName: 'http.example.com', endpointConfiguration: { types: ['REGIONAL'] } },
        { domainName: 'unused.example.com', endpointConfiguration: { types: ['REGIONAL'] } }
      ]
    });
    apigw.on(GetBasePathMappingsCommand, { domainName: 'api.example.com' }).resolves({
      items: [{ basePath: '(none)', restApiId: 'api1', stage: 'prod' }, { basePath: 'v1', restApiId: 'api1', stage: 'prod' }]
    });
    apigw.on(GetBasePathMappingsCommand, { domainName: 'private.example.com' }).resolves({
      items: [{ basePath: 'v2', restApiId: 'api1', stage: 'prod' }]
    });
    // Only mapped to an HTTP API: owned by the apigatewayv2 service.
    apigw.on(GetBasePathMappingsCommand, { domainName: 'http.example.com' }).resolves({
      items: [{ basePath: '(none)', restApiId: 'httpapi', stage: '$default' }]
    });

    const service = createService(APIGatewayService, 'api_gateway');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_api_gateway_base_path_mapping:api.example.com/',
      'aws_api_gateway_base_path_mapping:api.example.com/v1',
      'aws_api_gateway_base_path_mapping:private.example.com/v2/abc123',
      'aws_api_gateway_domain_name:api.example.com',
      'aws_api_gateway_domain_name:private.example.com/abc123',
      'aws_api_gateway_domain_name:unused.example.com',
      'aws_api_gateway_rest_api:api1',
      'aws_api_gateway_usage_plan:up1',
      'aws_api_gateway_usage_plan_key:up1/k1',
      'aws_api_gateway_vpc_link:vl1'
    ]);
    expect(service.getWarnings()).toEqual([]);
  });
});
