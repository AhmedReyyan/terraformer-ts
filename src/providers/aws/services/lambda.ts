import { BaseService } from '../../../core/provider';
import { TerraformResource, ResourceFilter, ProviderConfig, Logger } from '../../../types';
import { 
  LambdaClient, 
  ListFunctionsCommand, 
  ListEventSourceMappingsCommand,
  ListLayersCommand,
  ListLayerVersionsCommand,
  GetPolicyCommand,
  ListFunctionEventInvokeConfigsCommand
} from '@aws-sdk/client-lambda';

interface Policy {
  Version: string;
  Id: string;
  Statement: Statement[];
}

interface Statement {
  Sid: string;
}

export class LambdaService extends BaseService {
  private client: LambdaClient;

  constructor(providerName: string, serviceName: string, config: ProviderConfig, logger: Logger) {
    super(providerName, serviceName, config, logger);
    this.client = new LambdaClient({
      region: config.region || 'us-east-1',
      credentials: config.credentials ? {
        accessKeyId: config.credentials.accessKeyId || '',
        secretAccessKey: config.credentials.secretAccessKey || '',
        sessionToken: config.credentials.sessionToken || undefined
      } : undefined
    });
  }

  async initResources(): Promise<void> {
    await this.loadFunctions();
    await this.loadEventSourceMappings();
    await this.loadLayerVersions();
  }

  private async loadFunctions(): Promise<void> {
    try {
      this.log('Loading Lambda functions...', 'info');
      
      const command = new ListFunctionsCommand({});
      const response = await this.client.send(command);
      
      let functionCount = 0;
      for (const func of response.Functions || []) {
        if (func.FunctionArn && func.FunctionName) {
          const resource = this.createResource(
            func.FunctionArn,
            func.FunctionName,
            'lambda_function',
            {
              function_name: func.FunctionName
            },
            {
              arn: func.FunctionArn,
              runtime: func.Runtime,
              handler: func.Handler,
              code_size: func.CodeSize,
              description: func.Description,
              timeout: func.Timeout,
              memory_size: func.MemorySize,
              last_modified: func.LastModified,
              code_sha256: func.CodeSha256,
              version: func.Version,
              vpc_config: func.VpcConfig,
              dead_letter_config: func.DeadLetterConfig,
              environment: func.Environment,
              kms_key_arn: func.KMSKeyArn,
              tracing_config: func.TracingConfig,
              master_arn: func.MasterArn,
              revision_id: func.RevisionId,
              layers: func.Layers?.map(layer => layer.Arn) || [],
              file_system_configs: func.FileSystemConfigs,
              package_type: func.PackageType,
              image_config_response: func.ImageConfigResponse,
              signing_profile_version_arn: func.SigningProfileVersionArn,
              signing_job_arn: func.SigningJobArn,
              architectures: func.Architectures,
              ephemeral_storage: func.EphemeralStorage,
              snap_start: func.SnapStart,
              runtime_version_config: func.RuntimeVersionConfig
            }
          );
          
          this.addResource(resource);
          functionCount++;
          
          // Load function policies and event invoke configs
          await this.loadFunctionPolicies(func.FunctionArn);
          await this.loadFunctionEventInvokeConfigs(func.FunctionName);
        }
      }
      
      this.log(`Loaded ${functionCount} Lambda functions`, 'info');
    } catch (error) {
      this.log(`Error loading Lambda functions: ${error}`, 'error');
      throw error;
    }
  }

  private async loadFunctionPolicies(functionArn: string): Promise<void> {
    try {
      const command = new GetPolicyCommand({ FunctionName: functionArn });
      const response = await this.client.send(command);
      
      if (response.Policy) {
        const policy: Policy = JSON.parse(response.Policy);
        
        for (const statement of policy.Statement) {
          if (statement.Sid) {
            const resource = this.createResource(
              statement.Sid,
              statement.Sid,
              'lambda_permission',
              {
                statement_id: statement.Sid,
                function_name: functionArn
              },
              {}
            );
            
            this.addResource(resource);
          }
        }
      }
    } catch (error: any) {
      // Skip ResourceNotFoundException as there may be only inline policies
      if (!error.name || error.name !== 'ResourceNotFoundException') {
        this.log(`Error loading function policies for ${functionArn}: ${error}`, 'debug');
      }
    }
  }

  private async loadFunctionEventInvokeConfigs(functionName: string): Promise<void> {
    try {
      const command = new ListFunctionEventInvokeConfigsCommand({ FunctionName: functionName });
      const response = await this.client.send(command);
      
      for (const config of response.FunctionEventInvokeConfigs || []) {
        if (config.FunctionArn) {
          const resource = this.createResource(
            config.FunctionArn,
            `feic_${config.FunctionArn}`,
            'lambda_function_event_invoke_config',
            {},
            {
              function_name: config.FunctionArn,
              maximum_retry_attempts: config.MaximumRetryAttempts,
              maximum_event_age_in_seconds: config.MaximumEventAgeInSeconds,
              destination_config: config.DestinationConfig
            }
          );
          
          this.addResource(resource);
        }
      }
    } catch (error) {
      this.log(`Error loading event invoke configs for ${functionName}: ${error}`, 'debug');
    }
  }

  private async loadEventSourceMappings(): Promise<void> {
    try {
      this.log('Loading Lambda event source mappings...', 'info');
      
      const command = new ListEventSourceMappingsCommand({});
      const response = await this.client.send(command);
      
      let mappingCount = 0;
      for (const mapping of response.EventSourceMappings || []) {
        if (mapping.UUID) {
          const resource = this.createResource(
            mapping.UUID,
            mapping.UUID,
            'lambda_event_source_mapping',
            {
              event_source_arn: mapping.EventSourceArn,
              function_name: mapping.FunctionArn
            },
            {
              uuid: mapping.UUID,
              last_modified: mapping.LastModified,
              last_processing_result: mapping.LastProcessingResult,
              state: mapping.State,
              state_transition_reason: mapping.StateTransitionReason,
              batch_size: mapping.BatchSize,
              maximum_batching_window_in_seconds: mapping.MaximumBatchingWindowInSeconds,
              parallelization_factor: mapping.ParallelizationFactor,
              starting_position: mapping.StartingPosition,
              starting_position_timestamp: mapping.StartingPositionTimestamp,
              maximum_record_age_in_seconds: mapping.MaximumRecordAgeInSeconds,
              bisect_batch_on_function_error: mapping.BisectBatchOnFunctionError,
              maximum_retry_attempts: mapping.MaximumRetryAttempts,
              tumbling_window_in_seconds: mapping.TumblingWindowInSeconds,
              function_response_types: mapping.FunctionResponseTypes,
              topics: mapping.Topics,
              queues: mapping.Queues,
              source_access_configurations: mapping.SourceAccessConfigurations,
              self_managed_event_source: mapping.SelfManagedEventSource,
              filter_criteria: mapping.FilterCriteria,
              amazon_managed_kafka_event_source_config: mapping.AmazonManagedKafkaEventSourceConfig,
              self_managed_kafka_event_source_config: mapping.SelfManagedKafkaEventSourceConfig,
              scaling_config: mapping.ScalingConfig,
              document_db_event_source_config: mapping.DocumentDBEventSourceConfig
            }
          );
          
          this.addResource(resource);
          mappingCount++;
        }
      }
      
      this.log(`Loaded ${mappingCount} Lambda event source mappings`, 'info');
    } catch (error) {
      this.log(`Error loading Lambda event source mappings: ${error}`, 'error');
      throw error;
    }
  }

  private async loadLayerVersions(): Promise<void> {
    try {
      this.log('Loading Lambda layer versions...', 'info');
      
      const layersCommand = new ListLayersCommand({});
      const layersResponse = await this.client.send(layersCommand);
      
      let layerVersionCount = 0;
      for (const layer of layersResponse.Layers || []) {
        if (layer.LayerName) {
          const versionsCommand = new ListLayerVersionsCommand({ LayerName: layer.LayerName });
          const versionsResponse = await this.client.send(versionsCommand);
          
          for (const layerVersion of versionsResponse.LayerVersions || []) {
            if (layerVersion.LayerVersionArn) {
              const resource = this.createResource(
                layerVersion.LayerVersionArn,
                layerVersion.LayerVersionArn,
                'lambda_layer_version',
                {},
                {
                  layer_name: layer.LayerName,
                  version: layerVersion.Version,
                  description: layerVersion.Description,
                  created_date: layerVersion.CreatedDate,
                  compatible_runtimes: layerVersion.CompatibleRuntimes || [],
                  license_info: layerVersion.LicenseInfo,
                  compatible_architectures: layerVersion.CompatibleArchitectures || []
                }
              );
              
              this.addResource(resource);
              layerVersionCount++;
            }
          }
        }
      }
      
      this.log(`Loaded ${layerVersionCount} Lambda layer versions`, 'info');
    } catch (error) {
      this.log(`Error loading Lambda layer versions: ${error}`, 'error');
      throw error;
    }
  }

  parseFilter(rawFilter: string): ResourceFilter[] {
    const filters: ResourceFilter[] = [];
    
    if (!rawFilter.includes('Name=') && rawFilter.includes('=')) {
      const [serviceName, resourcesId] = rawFilter.split('=');
      filters.push({
        serviceName,
        fieldPath: 'id',
        acceptableValues: resourcesId.split(':'),
        isApplicable: (resourceName: string) => serviceName === '' || serviceName === resourceName
      });
    } else {
      const parts = rawFilter.split(';');
      if (parts.length >= 1) {
        const serviceName = parts[0].startsWith('Type=') ? parts[0].substring(5) : '';
        const fieldPath = parts[1]?.startsWith('Name=') ? parts[1].substring(5) : parts[0];
        const acceptableValues = parts[2]?.startsWith('Value=') ? 
          parts[2].substring(6).split(':') : undefined;

        filters.push({
          serviceName,
          fieldPath,
          acceptableValues: acceptableValues || [],
          isApplicable: (resourceName: string) => serviceName === '' || serviceName === resourceName
        });
      }
    }

    return filters;
  }

  async postConvertHook(): Promise<void> {
    this.log('Running Lambda post-conversion hook...', 'debug');
    
    // Post-process resources to format environment variables
    for (const resource of this.resources) {
      if (resource.type === 'aws_lambda_function' && resource.additionalFields?.environment) {
        const env = resource.additionalFields.environment;
        if (env.variables) {
          resource.attributes.environment = [{
            variables: [env.variables]
          }];
        }
      }
      
      // Remove maximum_event_age_in_seconds if it's 0
      if (resource.type === 'aws_lambda_function_event_invoke_config' && 
          resource.additionalFields?.maximum_event_age_in_seconds === 0) {
        delete resource.attributes.maximum_event_age_in_seconds;
      }
    }
  }
}

