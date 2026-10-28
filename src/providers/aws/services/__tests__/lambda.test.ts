import { mockClient } from 'aws-sdk-client-mock';
import {
  LambdaClient,
  ListFunctionsCommand,
  ListAliasesCommand,
  ListEventSourceMappingsCommand,
  ListLayersCommand,
  ListFunctionUrlConfigsCommand,
  ListFunctionEventInvokeConfigsCommand,
  ListProvisionedConcurrencyConfigsCommand,
  GetPolicyCommand
} from '@aws-sdk/client-lambda';
import { LambdaService } from '../lambda';
import { createService, importIds, notFound } from './helpers';

const lambda = mockClient(LambdaClient);
const fnArn = (name: string) => `arn:aws:lambda:us-east-1:123456789012:function:${name}`;

beforeEach(() => {
  lambda.reset();
  lambda.on(ListAliasesCommand).resolves({ Aliases: [] });
  lambda.on(ListEventSourceMappingsCommand).resolves({ EventSourceMappings: [] });
  lambda.on(ListLayersCommand).resolves({ Layers: [] });
  lambda.on(ListFunctionUrlConfigsCommand).resolves({ FunctionUrlConfigs: [] });
  lambda.on(ListFunctionEventInvokeConfigsCommand).resolves({ FunctionEventInvokeConfigs: [] });
  lambda.on(ListProvisionedConcurrencyConfigsCommand).resolves({ ProvisionedConcurrencyConfigs: [] });
  lambda.on(GetPolicyCommand).rejects(notFound('ResourceNotFoundException'));
});

describe('LambdaService', () => {
  it('imports functions with their aliases, URLs, invoke configs, permissions and mappings', async () => {
    lambda.on(ListFunctionsCommand)
      .resolvesOnce({ Functions: [{ FunctionName: 'api', FunctionArn: fnArn('api') }], NextMarker: 'm1' })
      .resolvesOnce({ Functions: [{ FunctionName: 'worker', FunctionArn: fnArn('worker') }] });
    lambda.on(ListAliasesCommand, { FunctionName: 'api' }).resolves({ Aliases: [{ Name: 'live' }] });
    lambda.on(ListFunctionUrlConfigsCommand, { FunctionName: 'api' }).resolves({
      FunctionUrlConfigs: [
        { FunctionArn: fnArn('api'), FunctionUrl: 'https://a', CreationTime: '', LastModifiedTime: '', AuthType: 'NONE' },
        { FunctionArn: `${fnArn('api')}:live`, FunctionUrl: 'https://b', CreationTime: '', LastModifiedTime: '', AuthType: 'AWS_IAM' }
      ]
    });
    lambda.on(ListFunctionEventInvokeConfigsCommand, { FunctionName: 'api' }).resolves({
      FunctionEventInvokeConfigs: [{ FunctionArn: `${fnArn('api')}:$LATEST` }, { FunctionArn: `${fnArn('api')}:live` }]
    });
    lambda.on(ListProvisionedConcurrencyConfigsCommand, { FunctionName: 'api' }).resolves({
      ProvisionedConcurrencyConfigs: [{ FunctionArn: `${fnArn('api')}:live` }]
    });
    lambda.on(GetPolicyCommand, { FunctionName: 'api' }).resolves({
      Policy: JSON.stringify({ Statement: [{ Sid: 'AllowS3', Effect: 'Allow' }, { Effect: 'Allow' }] })
    });
    lambda.on(ListEventSourceMappingsCommand)
      .resolvesOnce({ EventSourceMappings: [{ UUID: 'uuid-1', FunctionArn: fnArn('worker'), EventSourceArn: 'arn:aws:sqs:us-east-1:1:jobs' }], NextMarker: 'e1' })
      .resolvesOnce({ EventSourceMappings: [{ UUID: 'uuid-2', State: 'Deleting' }] });
    lambda.on(ListLayersCommand).resolves({
      Layers: [{ LayerName: 'deps', LatestMatchingVersion: { LayerVersionArn: 'arn:aws:lambda:us-east-1:123456789012:layer:deps:4', Version: 4 } }]
    });

    const service = createService(LambdaService, 'lambda');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_lambda_alias:api/live',
      'aws_lambda_event_source_mapping:uuid-1',
      'aws_lambda_function:api',
      'aws_lambda_function:worker',
      'aws_lambda_function_event_invoke_config:api',
      'aws_lambda_function_event_invoke_config:api:live',
      'aws_lambda_function_url:api',
      'aws_lambda_function_url:api/live',
      'aws_lambda_layer_version:arn:aws:lambda:us-east-1:123456789012:layer:deps:4',
      'aws_lambda_permission:api/AllowS3',
      'aws_lambda_provisioned_concurrency_config:api,live'
    ]);
    expect(service.getWarnings()).toEqual([]);
  });
});
