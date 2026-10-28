import {
  ConfigServiceClient,
  DescribeConfigurationRecordersCommand,
  DescribeDeliveryChannelsCommand,
  paginateDescribeAggregationAuthorizations,
  paginateDescribeConfigRules,
  paginateDescribeConfigurationAggregators,
  paginateDescribeConformancePacks,
  paginateDescribeRetentionConfigurations
} from '@aws-sdk/client-config-service';
import { AwsService } from '../aws-service';

export class ConfigService extends AwsService {
  async initResources(): Promise<void> {
    const config = this.client(ConfigServiceClient);

    await this.collect('Config configuration recorders', async () => {
      const response = await config.send(new DescribeConfigurationRecordersCommand({}));
      for (const recorder of response.ConfigurationRecorders || []) {
        // Service-linked recorders (servicePrincipal set) are owned by the AWS service that created them.
        if (!recorder.name || recorder.servicePrincipal) continue;
        this.add('aws_config_configuration_recorder', recorder.name, recorder.name, { name: recorder.name, arn: recorder.arn });
        this.add('aws_config_configuration_recorder_status', recorder.name, recorder.name, { name: recorder.name });
      }
    });

    await this.collect('Config delivery channels', async () => {
      const response = await config.send(new DescribeDeliveryChannelsCommand({}));
      for (const channel of response.DeliveryChannels || []) {
        if (channel.name) {
          this.add('aws_config_delivery_channel', channel.name, channel.name, { name: channel.name, s3_bucket_name: channel.s3BucketName });
        }
      }
    });

    await this.collect('Config rules', async () => {
      for await (const page of paginateDescribeConfigRules({ client: config }, {})) {
        for (const rule of page.ConfigRules || []) {
          const name = rule.ConfigRuleName;
          // CreatedBy is set for rules owned by another service (Security Hub, conformance packs, ...).
          // Control Tower deploys its rules through StackSets with a reserved AWSControlTower_ prefix.
          if (!name || rule.CreatedBy || name.startsWith('AWSControlTower_') || rule.ConfigRuleState === 'DELETING') continue;
          this.add('aws_config_config_rule', name, name, { name, arn: rule.ConfigRuleArn });
        }
      }
    });

    await this.collect('Config conformance packs', async () => {
      for await (const page of paginateDescribeConformancePacks({ client: config }, {})) {
        for (const pack of page.ConformancePackDetails || []) {
          const name = pack.ConformancePackName;
          // Packs created by another service (e.g. organization conformance packs) have CreatedBy set.
          if (!name || pack.CreatedBy) continue;
          this.add('aws_config_conformance_pack', name, name, { name, arn: pack.ConformancePackArn });
        }
      }
    });

    await this.collect('Config configuration aggregators', async () => {
      for await (const page of paginateDescribeConfigurationAggregators({ client: config }, {})) {
        for (const aggregator of page.ConfigurationAggregators || []) {
          const name = aggregator.ConfigurationAggregatorName;
          // Service-linked aggregators (e.g. created by Security Hub or Firewall Manager) have CreatedBy set.
          if (!name || aggregator.CreatedBy) continue;
          this.add('aws_config_configuration_aggregator', name, name, { name, arn: aggregator.ConfigurationAggregatorArn });
        }
      }
    });

    await this.collect('Config aggregate authorizations', async () => {
      for await (const page of paginateDescribeAggregationAuthorizations({ client: config }, {})) {
        for (const authorization of page.AggregationAuthorizations || []) {
          const { AuthorizedAccountId: account, AuthorizedAwsRegion: region } = authorization;
          if (account && region) {
            this.add('aws_config_aggregate_authorization', `${account}:${region}`, `${account}-${region}`, {
              account_id: account,
              authorized_aws_region: region,
              arn: authorization.AggregationAuthorizationArn
            });
          }
        }
      }
    });

    await this.collect('Config retention configurations', async () => {
      for await (const page of paginateDescribeRetentionConfigurations({ client: config }, {})) {
        for (const retention of page.RetentionConfigurations || []) {
          if (retention.Name) {
            this.add('aws_config_retention_configuration', retention.Name, retention.Name, { name: retention.Name });
          }
        }
      }
    });
  }
}
