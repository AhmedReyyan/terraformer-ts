import { mockClient } from 'aws-sdk-client-mock';
import {
  ConfigServiceClient,
  DescribeAggregationAuthorizationsCommand,
  DescribeConfigRulesCommand,
  DescribeConfigurationAggregatorsCommand,
  DescribeConfigurationRecordersCommand,
  DescribeConformancePacksCommand,
  DescribeDeliveryChannelsCommand,
  DescribeRetentionConfigurationsCommand
} from '@aws-sdk/client-config-service';
import { ConfigService } from '../config';
import { createService, importIds } from './helpers';

const config = mockClient(ConfigServiceClient);

beforeEach(() => config.reset());

describe('ConfigService', () => {
  it('imports customer-managed Config resources and skips service-owned ones', async () => {
    config.on(DescribeConfigurationRecordersCommand).resolves({
      ConfigurationRecorders: [
        { name: 'default' },
        { name: 'AWSConfigurationRecorderForSecurityHub', servicePrincipal: 'securityhub.amazonaws.com' }
      ]
    });
    config.on(DescribeDeliveryChannelsCommand).resolves({ DeliveryChannels: [{ name: 'default' }] });
    config.on(DescribeConfigRulesCommand)
      .resolvesOnce({
        ConfigRules: [
          { ConfigRuleName: 's3-encrypted', Source: undefined },
          { ConfigRuleName: 'securityhub-mfa-enabled-abc', CreatedBy: 'securityhub.amazonaws.com', Source: undefined }
        ],
        NextToken: 'p2'
      })
      .resolvesOnce({
        ConfigRules: [
          { ConfigRuleName: 'AWSControlTower_AWS-GR_ENCRYPTED_VOLUMES', Source: undefined },
          { ConfigRuleName: 'going-away', ConfigRuleState: 'DELETING', Source: undefined },
          { ConfigRuleName: 'iam-root-key', Source: undefined }
        ]
      });
    config.on(DescribeConformancePacksCommand).resolves({
      ConformancePackDetails: [
        { ConformancePackName: 'pci', ConformancePackArn: 'arn:pci', ConformancePackId: 'c1' },
        { ConformancePackName: 'OrgConformsPack-x', ConformancePackArn: 'arn:x', ConformancePackId: 'c2', CreatedBy: 'config-multiaccountsetup.amazonaws.com' }
      ]
    });
    config.on(DescribeConfigurationAggregatorsCommand).resolves({
      ConfigurationAggregators: [
        { ConfigurationAggregatorName: 'org' },
        { ConfigurationAggregatorName: 'aws-controltower-GuardrailsComplianceAggregator', CreatedBy: 'controltower.amazonaws.com' }
      ]
    });
    config.on(DescribeAggregationAuthorizationsCommand).resolves({
      AggregationAuthorizations: [{ AuthorizedAccountId: '111111111111', AuthorizedAwsRegion: 'us-east-1' }]
    });
    config.on(DescribeRetentionConfigurationsCommand).resolves({ RetentionConfigurations: [{ Name: 'default', RetentionPeriodInDays: 365 }] });

    const service = createService(ConfigService, 'config');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_config_aggregate_authorization:111111111111:us-east-1',
      'aws_config_config_rule:iam-root-key',
      'aws_config_config_rule:s3-encrypted',
      'aws_config_configuration_aggregator:org',
      'aws_config_configuration_recorder:default',
      'aws_config_configuration_recorder_status:default',
      'aws_config_conformance_pack:pci',
      'aws_config_delivery_channel:default',
      'aws_config_retention_configuration:default'
    ]);
    expect(config.commandCalls(DescribeConfigRulesCommand)[1].args[0].input).toMatchObject({ NextToken: 'p2' });
    expect(service.getWarnings()).toEqual([]);
  });
});
