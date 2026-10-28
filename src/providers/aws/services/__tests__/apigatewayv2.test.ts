import { mockClient } from 'aws-sdk-client-mock';
import {
  ApiGatewayV2Client,
  GetApisCommand,
  GetStagesCommand,
  GetRoutesCommand,
  GetIntegrationsCommand,
  GetAuthorizersCommand,
  GetDomainNamesCommand,
  GetApiMappingsCommand,
  GetVpcLinksCommand
} from '@aws-sdk/client-apigatewayv2';
import { APIGatewayV2Service } from '../apigatewayv2';
import { createService, importIds } from './helpers';

const apigw = mockClient(ApiGatewayV2Client);

beforeEach(() => {
  apigw.reset();
  for (const command of [
    GetApisCommand, GetStagesCommand, GetRoutesCommand, GetIntegrationsCommand, GetAuthorizersCommand,
    GetDomainNamesCommand, GetApiMappingsCommand, GetVpcLinksCommand
  ]) {
    apigw.on(command as any).resolves({ Items: [] });
  }
});

describe('APIGatewayV2Service', () => {
  it('imports APIs and children, skipping API Gateway managed (quick create) objects', async () => {
    apigw.on(GetApisCommand)
      .resolvesOnce({ Items: [{ ApiId: 'a1', Name: 'http', ProtocolType: 'HTTP', RouteSelectionExpression: '' }], NextToken: 'n2' })
      .resolvesOnce({ Items: [{ ApiId: 'a2', Name: 'managed', ProtocolType: 'HTTP', RouteSelectionExpression: '', ApiGatewayManaged: true }] });
    apigw.on(GetStagesCommand, { ApiId: 'a1' }).resolves({
      Items: [
        { StageName: '$default', ApiGatewayManaged: true, AutoDeploy: true, DeploymentId: 'auto1' },
        { StageName: 'prod', DeploymentId: 'd1', AutoDeploy: false },
        { StageName: 'dev', DeploymentId: 'auto2', AutoDeploy: true }
      ]
    });
    apigw.on(GetRoutesCommand, { ApiId: 'a1' })
      .resolvesOnce({ Items: [{ RouteId: 'r1', RouteKey: 'GET /orders' }], NextToken: 'r2' })
      .resolvesOnce({ Items: [{ RouteId: 'r2', RouteKey: '$default', ApiGatewayManaged: true }] });
    apigw.on(GetIntegrationsCommand, { ApiId: 'a1' }).resolves({
      Items: [{ IntegrationId: 'i1' }, { IntegrationId: 'i2', ApiGatewayManaged: true }]
    });
    apigw.on(GetAuthorizersCommand, { ApiId: 'a1' }).resolves({ Items: [{ AuthorizerId: 'au1', Name: 'jwt' }] });
    apigw.on(GetVpcLinksCommand).resolves({
      Items: [
        { VpcLinkId: 'vl1', Name: 'link', SecurityGroupIds: [], SubnetIds: [], VpcLinkStatus: 'AVAILABLE' },
        { VpcLinkId: 'vl2', Name: 'bye', SecurityGroupIds: [], SubnetIds: [], VpcLinkStatus: 'DELETING' }
      ]
    });

    const service = createService(APIGatewayV2Service, 'apigatewayv2');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_apigatewayv2_api:a1',
      'aws_apigatewayv2_authorizer:a1/au1',
      'aws_apigatewayv2_deployment:a1/d1',
      'aws_apigatewayv2_integration:a1/i1',
      'aws_apigatewayv2_route:a1/r1',
      'aws_apigatewayv2_stage:a1/dev',
      'aws_apigatewayv2_stage:a1/prod',
      'aws_apigatewayv2_vpc_link:vl1'
    ]);
    expect(apigw.commandCalls(GetStagesCommand, { ApiId: 'a2' })).toHaveLength(0);
    expect(service.getWarnings()).toEqual([]);
  });

  it('imports domain names only mapped to v2 APIs and only mappings to v2 APIs', async () => {
    apigw.on(GetApisCommand).resolves({ Items: [{ ApiId: 'a1', Name: 'http', ProtocolType: 'HTTP', RouteSelectionExpression: '' }] });
    apigw.on(GetDomainNamesCommand).resolves({
      Items: [{ DomainName: 'http.example.com' }, { DomainName: 'mixed.example.com' }, { DomainName: 'empty.example.com' }]
    });
    apigw.on(GetApiMappingsCommand, { DomainName: 'http.example.com' }).resolves({
      Items: [{ ApiMappingId: 'm1', ApiId: 'a1', Stage: 'prod', ApiMappingKey: '' }]
    });
    apigw.on(GetApiMappingsCommand, { DomainName: 'mixed.example.com' })
      .resolvesOnce({ Items: [{ ApiMappingId: 'm2', ApiId: 'a1', Stage: 'prod', ApiMappingKey: 'v2' }], NextToken: 'm' })
      .resolvesOnce({ Items: [{ ApiMappingId: 'm3', ApiId: 'restapi', Stage: 'prod', ApiMappingKey: 'v1' }] });

    const service = createService(APIGatewayV2Service, 'apigatewayv2');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_apigatewayv2_api:a1',
      'aws_apigatewayv2_api_mapping:m1/http.example.com',
      'aws_apigatewayv2_api_mapping:m2/mixed.example.com',
      'aws_apigatewayv2_domain_name:http.example.com'
    ]);
  });
});
