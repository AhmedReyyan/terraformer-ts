import { BaseProvider } from '../../core/provider';
import { BaseService } from '../../core/provider';
import { 
  ProviderConfig, 
  ProviderData, 
  ResourceConnection, 
  Logger 
} from '../../types';
import { 
  EC2Service, 
  S3Service, 
  IAMService, 
  RDSService, 
  LambdaService,
  CloudFormationService,
  Route53Service,
  ElastiCacheService,
  ELBService,
  ECSService,
  EKSService,
  ElasticsearchService,
  KinesisService,
  SNSService,
  SQSService,
  DynamoDBService,
  CloudFrontService,
  CloudWatchService,
  CloudWatchLogsService,
  SecretsManagerService,
  KMSService
} from './services';

export class AWSProvider extends BaseProvider {
  private region: string;
  private profile: string;

  constructor(config: ProviderConfig, logger: Logger) {
    super('aws', config, logger);
    this.region = config.region || 'us-east-1';
    this.profile = config.profile || 'default';
  }

  async init(args: string[]): Promise<void> {
    if (args.length > 0) {
      this.region = args[0];
    }
    if (args.length > 1) {
      this.profile = args[1];
    }

    // Set environment variables for AWS SDK
    if (this.region && this.region !== 'aws-global') {
      process.env.AWS_REGION = this.region;
      process.env.AWS_DEFAULT_REGION = this.region;
    }

    if (this.profile && this.profile !== 'default') {
      process.env.AWS_PROFILE = this.profile;
    }

    this.config.region = this.region;
    this.config.profile = this.profile;
  }

  getSupportedServices(): Record<string, typeof BaseService> {
    return {
      'ec2': EC2Service,
      's3': S3Service,
      'iam': IAMService,
      'rds': RDSService,
      'lambda': LambdaService,
      'cloudformation': CloudFormationService,
      'route53': Route53Service,
      'elasticache': ElastiCacheService,
      'elb': ELBService,
      'alb': ELBService, // Application Load Balancer
      'ecs': ECSService,
      'eks': EKSService,
      'elasticsearch': ElasticsearchService,
      'kinesis': KinesisService,
      'sns': SNSService,
      'sqs': SQSService,
      'dynamodb': DynamoDBService,
      'cloudfront': CloudFrontService,
      'cloudwatch': CloudWatchService,
      'logs': CloudWatchLogsService,
      'secretsmanager': SecretsManagerService,
      'kms': KMSService
    };
  }

  getResourceConnections(): ResourceConnection {
    return {
      'alb': {
        'sg': ['security_groups', 'id'],
        'subnet': ['subnets', 'id'],
        'alb': ['load_balancer_arn', 'id', 'listener_arn', 'id']
      },
      'auto_scaling': {
        'sg': ['security_groups', 'id'],
        'subnet': ['vpc_zone_identifier', 'id']
      },
      'ec2_instance': {
        'sg': ['vpc_security_group_ids', 'id'],
        'subnet': ['subnet_id', 'id'],
        'ebs': ['ebs_block_device', 'id']
      },
      'elasticache': {
        'vpc': ['vpc_id', 'id'],
        'subnet': ['subnet_ids', 'id'],
        'sg': ['security_group_ids', 'id']
      },
      'ebs': {},
      'ecs': {
        'subnet': ['network_configuration.subnets', 'id'],
        'sg': ['network_configuration.security_groups', 'id']
      },
      'eks': {
        'subnet': ['vpc_config.subnet_ids', 'id'],
        'sg': ['vpc_config.security_group_ids', 'id']
      },
      'elb': {
        'sg': ['security_groups', 'id'],
        'subnet': ['subnets', 'id']
      },
      'igw': {
        'vpc': ['vpc_id', 'id']
      },
      'msk': {
        'subnet': ['broker_node_group_info.client_subnets', 'id'],
        'sg': ['broker_node_group_info.security_groups', 'id']
      },
      'nacl': {
        'subnet': ['subnet_ids', 'id'],
        'vpc': ['vpc_id', 'id']
      },
      'organization': {
        'organization': ['policy_id', 'id', 'parent_id', 'id', 'target_id', 'id']
      },
      'rds': {
        'subnet': ['subnet_ids', 'id'],
        'sg': ['vpc_security_group_ids', 'id']
      },
      'route_table': {
        'route_table': ['route_table_id', 'id'],
        'subnet': ['subnet_id', 'id'],
        'vpc': ['vpc_id', 'id']
      },
      'sns': {
        'sns': ['topic_arn', 'id'],
        'sqs': ['endpoint', 'arn']
      },
      'sg': {
        'sg': [
          'egress.security_groups', 'id',
          'ingress.security_groups', 'id',
          'security_group_id', 'id',
          'source_security_group_id', 'id'
        ]
      },
      'subnet': {
        'vpc': ['vpc_id', 'id']
      },
      'transit_gateway': {
        'vpc': ['vpc_id', 'id'],
        'transit_gateway': ['transit_gateway_id', 'id'],
        'subnet': ['subnet_ids', 'id'],
        'vpn_connection': ['vpn_connection_id', 'id']
      },
      'vpn_gateway': {
        'vpc': ['vpc_id', 'id']
      },
      'vpn_connection': {
        'customer_gateway': ['customer_gateway_id', 'id'],
        'vpn_gateway': ['vpn_gateway_id', 'id']
      }
    };
  }

  getProviderData(): ProviderData {
    const awsConfig: Record<string, any> = {};

    if (this.region === 'aws-global') {
      awsConfig.region = 'us-east-1'; // Default region for global services
    } else if (this.region) {
      awsConfig.region = this.region;
    }

    if (this.profile && this.profile !== 'default') {
      awsConfig.profile = this.profile;
    }

    return {
      provider: {
        aws: awsConfig
      },
      terraform: {
        required_providers: [{
          aws: {
            source: 'hashicorp/aws',
            version: '~> 5.0'
          }
        }]
      }
    };
  }

  getConfig(): Record<string, any> {
    const config: Record<string, any> = {
      skip_region_validation: true
    };

    if (this.region !== 'aws-global') {
      config.region = this.region;
    }

    return config;
  }
}


