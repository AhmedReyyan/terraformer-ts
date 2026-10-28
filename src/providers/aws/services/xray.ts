import { XRayClient, GetEncryptionConfigCommand, paginateGetGroups, paginateGetSamplingRules } from '@aws-sdk/client-xray';
import { AwsService } from '../aws-service';

/** Every region has a built-in `Default` sampling rule and group. */
const DEFAULT = 'Default';

export class XRayService extends AwsService {
  async initResources(): Promise<void> {
    const xray = this.client(XRayClient);

    await this.collect('X-Ray sampling rules', async () => {
      for await (const page of paginateGetSamplingRules({ client: xray }, {})) {
        for (const record of page.SamplingRuleRecords || []) {
          const name = record.SamplingRule?.RuleName;
          if (name && name !== DEFAULT) {
            this.add('aws_xray_sampling_rule', name, name, { name, arn: record.SamplingRule?.RuleARN });
          }
        }
      }
    });

    await this.collect('X-Ray groups', async () => {
      for await (const page of paginateGetGroups({ client: xray }, {})) {
        for (const group of page.Groups || []) {
          if (group.GroupARN && group.GroupName && group.GroupName !== DEFAULT) {
            this.add('aws_xray_group', group.GroupARN, group.GroupName, { name: group.GroupName, arn: group.GroupARN });
          }
        }
      }
    });

    await this.collect('X-Ray encryption config', async () => {
      // A regional singleton that always exists; only worth importing when changed from the default (NONE) to KMS.
      const { EncryptionConfig: config } = await xray.send(new GetEncryptionConfigCommand({}));
      if (config?.Type === 'KMS') {
        this.add('aws_xray_encryption_config', this.region, `encryption-${this.region}`, { type: config.Type, key_id: config.KeyId });
      }
    });
  }
}
