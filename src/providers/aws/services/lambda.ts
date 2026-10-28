import {
  LambdaClient,
  paginateListFunctions,
  paginateListAliases,
  paginateListEventSourceMappings,
  paginateListLayers,
  paginateListFunctionUrlConfigs,
  paginateListFunctionEventInvokeConfigs,
  paginateListProvisionedConcurrencyConfigs,
  GetPolicyCommand,
  FunctionConfiguration
} from '@aws-sdk/client-lambda';
import { mapLimit } from '../../../core/provider';
import { AwsService, optional, arnResourceName } from '../aws-service';

/**
 * `function_name` or `function_name<separator>qualifier` from a (possibly qualified) function ARN
 * `arn:aws:lambda:<region>:<account>:function:<name>[:<qualifier>]`. `$LATEST` is the unqualified function.
 */
function qualifiedName(functionArn: string, separator: string): { name: string; qualifier?: string; id: string } {
  const parts = functionArn.split(':');
  const name = parts[6] || functionArn;
  const qualifier = parts[7] && parts[7] !== '$LATEST' ? parts[7] : undefined;
  return { name, qualifier, id: qualifier ? `${name}${separator}${qualifier}` : name };
}

interface PolicyStatement {
  Sid?: string;
}

export class LambdaService extends AwsService {
  private lambda!: LambdaClient;

  async initResources(): Promise<void> {
    this.lambda = this.client(LambdaClient);
    const functions: FunctionConfiguration[] = [];

    await this.collect('Lambda functions', async () => {
      for await (const page of paginateListFunctions({ client: this.lambda }, {})) {
        for (const fn of page.Functions || []) {
          if (fn.FunctionName) {
            functions.push(fn);
            this.add('aws_lambda_function', fn.FunctionName, fn.FunctionName, {
              function_name: fn.FunctionName,
              arn: fn.FunctionArn,
              runtime: fn.Runtime
            });
          }
        }
      }
    });

    await mapLimit(functions, 5, fn => this.collect(`Lambda configuration of ${fn.FunctionName}`, () => this.loadFunction(fn.FunctionName!)));

    await this.collect('Lambda event source mappings', async () => {
      for await (const page of paginateListEventSourceMappings({ client: this.lambda }, {})) {
        for (const mapping of page.EventSourceMappings || []) {
          // Skip mappings that are being deleted.
          if (!mapping.UUID || mapping.State === 'Deleting') {
            continue;
          }
          const functionName = mapping.FunctionArn ? qualifiedName(mapping.FunctionArn, ':').name : mapping.UUID;
          const source = mapping.EventSourceArn ? arnResourceName(mapping.EventSourceArn) : 'source';
          this.add('aws_lambda_event_source_mapping', mapping.UUID, `${functionName}-${source}`, {
            uuid: mapping.UUID,
            function_arn: mapping.FunctionArn,
            event_source_arn: mapping.EventSourceArn
          });
        }
      }
    });

    await this.collect('Lambda layers', async () => {
      for await (const page of paginateListLayers({ client: this.lambda }, {})) {
        for (const layer of page.Layers || []) {
          // Only the latest version of each layer; older versions are immutable history.
          const version = layer.LatestMatchingVersion;
          if (layer.LayerName && version?.LayerVersionArn) {
            this.add('aws_lambda_layer_version', version.LayerVersionArn, layer.LayerName, {
              layer_name: layer.LayerName,
              version: version.Version,
              arn: version.LayerVersionArn
            });
          }
        }
      }
    });
  }

  private async loadFunction(functionName: string): Promise<void> {
    const lambda = this.lambda;

    for await (const page of paginateListAliases({ client: lambda }, { FunctionName: functionName })) {
      for (const alias of page.Aliases || []) {
        if (alias.Name) {
          this.add('aws_lambda_alias', `${functionName}/${alias.Name}`, `${functionName}-${alias.Name}`, {
            function_name: functionName,
            name: alias.Name,
            arn: alias.AliasArn
          });
        }
      }
    }

    for await (const page of paginateListFunctionUrlConfigs({ client: lambda }, { FunctionName: functionName })) {
      for (const url of page.FunctionUrlConfigs || []) {
        const { id, qualifier } = qualifiedName(url.FunctionArn || functionName, '/');
        this.add('aws_lambda_function_url', id, id, {
          function_name: functionName,
          qualifier,
          function_url: url.FunctionUrl
        });
      }
    }

    for await (const page of paginateListFunctionEventInvokeConfigs({ client: lambda }, { FunctionName: functionName })) {
      for (const config of page.FunctionEventInvokeConfigs || []) {
        const { id, qualifier } = qualifiedName(config.FunctionArn || functionName, ':');
        this.add('aws_lambda_function_event_invoke_config', id, id, { function_name: functionName, qualifier });
      }
    }

    for await (const page of paginateListProvisionedConcurrencyConfigs({ client: lambda }, { FunctionName: functionName })) {
      for (const config of page.ProvisionedConcurrencyConfigs || []) {
        const { qualifier } = qualifiedName(config.FunctionArn || functionName, ',');
        // Provisioned concurrency always targets a version or alias.
        if (qualifier) {
          this.add('aws_lambda_provisioned_concurrency_config', `${functionName},${qualifier}`, `${functionName}-${qualifier}`, {
            function_name: functionName,
            qualifier
          });
        }
      }
    }

    // Permissions are the statements of the function's (unqualified) resource-based policy.
    const policy = await optional(lambda.send(new GetPolicyCommand({ FunctionName: functionName })));
    if (policy?.Policy) {
      const document = JSON.parse(policy.Policy) as { Statement?: PolicyStatement | PolicyStatement[] };
      const statements = Array.isArray(document.Statement) ? document.Statement : document.Statement ? [document.Statement] : [];
      for (const statement of statements) {
        // aws_lambda_permission is identified by its statement ID; statements without one cannot be imported.
        if (statement.Sid) {
          this.add('aws_lambda_permission', `${functionName}/${statement.Sid}`, `${functionName}-${statement.Sid}`, {
            function_name: functionName,
            statement_id: statement.Sid
          });
        }
      }
    }
  }
}
