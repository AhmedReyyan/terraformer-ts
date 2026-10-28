import {
  APIGatewayClient,
  paginateGetRestApis,
  paginateGetResources,
  paginateGetModels,
  paginateGetUsagePlans,
  paginateGetUsagePlanKeys,
  paginateGetDomainNames,
  paginateGetBasePathMappings,
  paginateGetVpcLinks,
  GetStagesCommand,
  GetAuthorizersCommand,
  GetGatewayResponsesCommand,
  GetRequestValidatorsCommand,
  BasePathMapping,
  DomainName,
  RestApi
} from '@aws-sdk/client-api-gateway';
import { mapLimit } from '../../../core/provider';
import { AwsService } from '../aws-service';

/** Models API Gateway creates automatically in every REST API. */
const BUILT_IN_MODELS = new Set(['Empty', 'Error']);

/** API Gateway returns this base path for a mapping without a path. */
const EMPTY_BASE_PATH = '(none)';

/** Iterate a `position`-paginated API that has no SDK paginator. */
async function* positionPages<T extends { position?: string }>(fetch: (position?: string) => Promise<T>): AsyncGenerator<T> {
  let position: string | undefined;
  do {
    const page = await fetch(position);
    yield page;
    position = page.position;
  } while (position);
}

/**
 * API Gateway REST APIs (v1) with their resources, methods, integrations, responses,
 * stages, deployments, authorizers, models, validators, gateway responses, usage plans,
 * custom domain names, base path mappings and VPC links.
 *
 * Not imported: aws_api_gateway_api_key (holds a secret value), aws_api_gateway_rest_api_policy
 * (the policy is the `policy` argument of aws_api_gateway_rest_api) and aws_api_gateway_account
 * (account-wide singleton).
 */
export class APIGatewayService extends AwsService {
  private apigw!: APIGatewayClient;
  private restApiIds = new Set<string>();
  private restApisListed = false;

  async initResources(): Promise<void> {
    this.apigw = this.client(APIGatewayClient);
    const apis: RestApi[] = [];

    await this.collect('API Gateway REST APIs', async () => {
      for await (const page of paginateGetRestApis({ client: this.apigw }, {})) {
        for (const api of page.items || []) {
          apis.push(api);
          this.restApiIds.add(api.id!);
          this.add('aws_api_gateway_rest_api', api.id!, api.name!, { name: api.name, id: api.id, tags: api.tags || {} });
        }
      }
      this.restApisListed = true;
    });

    await mapLimit(apis, 3, api => this.loadRestApi(api));

    await this.collect('API Gateway usage plans', async () => {
      for await (const page of paginateGetUsagePlans({ client: this.apigw }, {})) {
        for (const plan of page.items || []) {
          this.add('aws_api_gateway_usage_plan', plan.id!, plan.name!, { name: plan.name, id: plan.id, tags: plan.tags || {} });
          for await (const keys of paginateGetUsagePlanKeys({ client: this.apigw }, { usagePlanId: plan.id })) {
            for (const key of keys.items || []) {
              // Only the association; the API key itself is not imported (secret value).
              this.add('aws_api_gateway_usage_plan_key', `${plan.id}/${key.id}`, `${plan.name}_${key.name || key.id}`, {
                usage_plan_id: plan.id, key_id: key.id, key_type: key.type
              });
            }
          }
        }
      }
    });

    await this.loadDomainNames();

    await this.collect('API Gateway VPC links', async () => {
      for await (const page of paginateGetVpcLinks({ client: this.apigw }, {})) {
        for (const link of page.items || []) {
          if (link.status === 'DELETING' || link.status === 'FAILED') {
            continue;
          }
          this.add('aws_api_gateway_vpc_link', link.id!, link.name!, { name: link.name, id: link.id, tags: link.tags || {} });
        }
      }
    });
  }

  private async loadRestApi(api: RestApi): Promise<void> {
    const restApiId = api.id!;
    const apiName = api.name || restApiId;

    await this.collect(`resources of REST API ${apiName}`, async () => {
      // embed=methods returns each method with its integration and responses in one call.
      for await (const page of paginateGetResources({ client: this.apigw }, { restApiId, embed: ['methods'] })) {
        for (const resource of page.items || []) {
          const path = resource.path || resource.id!;
          // The root resource "/" is created with the REST API and is not a separate resource.
          if (resource.path !== '/') {
            this.add('aws_api_gateway_resource', `${restApiId}/${resource.id}`, `${apiName}_${path}`, {
              rest_api_id: restApiId, id: resource.id, path
            });
          }
          for (const [httpMethod, method] of Object.entries(resource.resourceMethods || {})) {
            const methodId = `${restApiId}/${resource.id}/${httpMethod}`;
            const methodName = `${apiName}_${path}_${httpMethod}`;
            const attributes = { rest_api_id: restApiId, resource_id: resource.id, path, http_method: httpMethod };
            this.add('aws_api_gateway_method', methodId, methodName, attributes);
            for (const statusCode of Object.keys(method.methodResponses || {})) {
              this.add('aws_api_gateway_method_response', `${methodId}/${statusCode}`, `${methodName}_${statusCode}`, {
                ...attributes, status_code: statusCode
              });
            }
            if (method.methodIntegration) {
              this.add('aws_api_gateway_integration', methodId, methodName, { ...attributes, type: method.methodIntegration.type });
              for (const statusCode of Object.keys(method.methodIntegration.integrationResponses || {})) {
                this.add('aws_api_gateway_integration_response', `${methodId}/${statusCode}`, `${methodName}_${statusCode}`, {
                  ...attributes, status_code: statusCode
                });
              }
            }
          }
        }
      }
    });

    await this.collect(`stages of REST API ${apiName}`, async () => {
      const response = await this.apigw.send(new GetStagesCommand({ restApiId }));
      const deploymentIds = new Set<string>();
      for (const stage of response.item || []) {
        const stageName = stage.stageName!;
        this.add('aws_api_gateway_stage', `${restApiId}/${stageName}`, `${apiName}_${stageName}`, {
          rest_api_id: restApiId, stage_name: stageName, deployment_id: stage.deploymentId, tags: stage.tags || {}
        });
        // Keys are the documented method_path: `{resource_path}/{http_method}` or `*/*`.
        for (const methodPath of Object.keys(stage.methodSettings || {})) {
          this.add('aws_api_gateway_method_settings', `${restApiId}/${stageName}/${methodPath}`, `${apiName}_${stageName}_${methodPath}`, {
            rest_api_id: restApiId, stage_name: stageName, method_path: methodPath
          });
        }
        if (stage.deploymentId) {
          deploymentIds.add(stage.deploymentId);
        }
      }
      // Only deployments that a stage points to; older deployments are history, not configuration.
      for (const deploymentId of deploymentIds) {
        this.add('aws_api_gateway_deployment', `${restApiId}/${deploymentId}`, `${apiName}_${deploymentId}`, {
          rest_api_id: restApiId, id: deploymentId
        });
      }
    });

    await this.collect(`authorizers of REST API ${apiName}`, async () => {
      for await (const page of positionPages(position => this.apigw.send(new GetAuthorizersCommand({ restApiId, position })))) {
        for (const authorizer of page.items || []) {
          this.add('aws_api_gateway_authorizer', `${restApiId}/${authorizer.id}`, `${apiName}_${authorizer.name}`, {
            rest_api_id: restApiId, id: authorizer.id, name: authorizer.name, type: authorizer.type
          });
        }
      }
    });

    await this.collect(`models of REST API ${apiName}`, async () => {
      for await (const page of paginateGetModels({ client: this.apigw }, { restApiId })) {
        for (const model of page.items || []) {
          if (BUILT_IN_MODELS.has(model.name!)) {
            continue;
          }
          this.add('aws_api_gateway_model', `${restApiId}/${model.name}`, `${apiName}_${model.name}`, {
            rest_api_id: restApiId, name: model.name, id: model.id
          });
        }
      }
    });

    await this.collect(`request validators of REST API ${apiName}`, async () => {
      for await (const page of positionPages(position => this.apigw.send(new GetRequestValidatorsCommand({ restApiId, position })))) {
        for (const validator of page.items || []) {
          this.add('aws_api_gateway_request_validator', `${restApiId}/${validator.id}`, `${apiName}_${validator.name || validator.id}`, {
            rest_api_id: restApiId, id: validator.id, name: validator.name
          });
        }
      }
    });

    await this.collect(`gateway responses of REST API ${apiName}`, async () => {
      for await (const page of positionPages(position => this.apigw.send(new GetGatewayResponsesCommand({ restApiId, position })))) {
        for (const response of page.items || []) {
          // Every REST API has a default for each response type; only customized ones are configuration.
          if (response.defaultResponse) {
            continue;
          }
          this.add('aws_api_gateway_gateway_response', `${restApiId}/${response.responseType}`, `${apiName}_${response.responseType}`, {
            rest_api_id: restApiId, response_type: response.responseType
          });
        }
      }
    });
  }

  private async loadDomainNames(): Promise<void> {
    const domains: DomainName[] = [];
    await this.collect('API Gateway domain names', async () => {
      for await (const page of paginateGetDomainNames({ client: this.apigw }, {})) {
        domains.push(...(page.items || []));
      }
    });
    await mapLimit(domains, 5, domain => this.collect(`base path mappings of ${domain.domainName}`, async () => {
      const domainName = domain.domainName!;
      const domainNameId = domain.domainNameId;
      const mappings: BasePathMapping[] = [];
      for await (const page of paginateGetBasePathMappings({ client: this.apigw }, { domainName, domainNameId })) {
        mappings.push(...(page.items || []));
      }

      // Regional domain names are shared with API Gateway v2. A domain whose mappings all point to
      // HTTP/WebSocket APIs is imported by the apigatewayv2 service as aws_apigatewayv2_domain_name.
      const restMappings = mappings.filter(mapping => this.restApiIds.has(mapping.restApiId!));
      const ownedByV2 = this.restApisListed && mappings.length > 0 && restMappings.length === 0 &&
        Boolean(domain.endpointConfiguration?.types?.includes('REGIONAL'));
      if (ownedByV2) {
        return;
      }

      // Private custom domain names are imported as `name/domain_name_id`.
      const domainId = domainNameId ? `${domainName}/${domainNameId}` : domainName;
      this.add('aws_api_gateway_domain_name', domainId, domainName, {
        domain_name: domainName, domain_name_id: domainNameId, tags: domain.tags || {}
      });

      for (const mapping of restMappings) {
        const basePath = mapping.basePath === EMPTY_BASE_PATH ? '' : mapping.basePath || '';
        // `domain/base_path` or `domain/base_path/domain_name_id`; an empty base path gives `domain/`.
        const id = domainNameId ? `${domainName}/${basePath}/${domainNameId}` : `${domainName}/${basePath}`;
        this.add('aws_api_gateway_base_path_mapping', id, `${domainName}_${basePath || 'root'}`, {
          domain_name: domainName, base_path: basePath, rest_api_id: mapping.restApiId, stage: mapping.stage
        });
      }
    }));
  }
}
