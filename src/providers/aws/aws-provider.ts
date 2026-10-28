import { BaseProvider, BaseService } from '../../core/provider';
import {
  ProviderConfig,
  ProviderData,
  ResourceConnection,
  Logger
} from '../../types';
import { AWS_SERVICES } from './services';
import { DEFAULT_REGION } from './aws-service';

export class AWSProvider extends BaseProvider {
  private region: string;
  private profile: string;

  constructor(config: ProviderConfig, logger: Logger) {
    super('aws', config, logger);
    this.region = config.region || DEFAULT_REGION;
    this.profile = config.profile || 'default';
  }

  /** args: [region, profile] */
  async init(args: string[]): Promise<void> {
    if (args.length > 0 && args[0]) {
      this.region = args[0];
    }
    if (args.length > 1 && args[1]) {
      this.profile = args[1];
    }
    this.config.region = this.region;
    this.config.profile = this.profile;
  }

  getScope(): string {
    return this.region;
  }

  getSupportedServices(): Record<string, typeof BaseService> {
    return AWS_SERVICES;
  }

  getTerraformEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    const credentials = this.config.credentials;
    if (credentials?.accessKeyId && credentials.secretAccessKey) {
      env.AWS_ACCESS_KEY_ID = credentials.accessKeyId;
      env.AWS_SECRET_ACCESS_KEY = credentials.secretAccessKey;
      if (credentials.sessionToken) {
        env.AWS_SESSION_TOKEN = credentials.sessionToken;
      }
    }
    return env;
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
    const awsConfig: Record<string, any> = {
      region: this.region === 'aws-global' ? DEFAULT_REGION : this.region
    };

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
            version: '~> 6.0'
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
