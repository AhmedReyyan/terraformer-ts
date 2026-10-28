import { mockClient } from 'aws-sdk-client-mock';
import { XRayClient, GetEncryptionConfigCommand, GetGroupsCommand, GetSamplingRulesCommand } from '@aws-sdk/client-xray';
import { XRayService } from '../xray';
import { createService, importIds } from './helpers';

const xray = mockClient(XRayClient);

const rule = (RuleName: string) => ({
  SamplingRule: {
    RuleName, ResourceARN: '*', Priority: 1, FixedRate: 0.05, ReservoirSize: 1,
    ServiceName: '*', ServiceType: '*', Host: '*', HTTPMethod: '*', URLPath: '*', Version: 1
  }
});

beforeEach(() => xray.reset());

describe('XRayService', () => {
  it('imports sampling rules across pages and groups, skipping the Default ones', async () => {
    xray.on(GetSamplingRulesCommand)
      .resolvesOnce({ SamplingRuleRecords: [rule('Default'), rule('api')], NextToken: 'p2' })
      .resolvesOnce({ SamplingRuleRecords: [rule('health-checks')] });
    xray.on(GetGroupsCommand).resolves({
      Groups: [
        { GroupName: 'Default', GroupARN: 'arn:aws:xray:us-east-1:123456789012:group/Default' },
        { GroupName: 'errors', GroupARN: 'arn:aws:xray:us-east-1:123456789012:group/errors/ABC' }
      ]
    });
    xray.on(GetEncryptionConfigCommand).resolves({ EncryptionConfig: { Type: 'NONE', Status: 'ACTIVE' } });

    const service = createService(XRayService, 'xray');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_xray_group:arn:aws:xray:us-east-1:123456789012:group/errors/ABC',
      'aws_xray_sampling_rule:api',
      'aws_xray_sampling_rule:health-checks'
    ]);
    expect(xray.commandCalls(GetSamplingRulesCommand)[1].args[0].input).toMatchObject({ NextToken: 'p2' });
    expect(service.getWarnings()).toEqual([]);
  });

  it('imports the encryption config by region only when it uses KMS', async () => {
    xray.on(GetSamplingRulesCommand).resolves({});
    xray.on(GetGroupsCommand).resolves({});
    xray.on(GetEncryptionConfigCommand).resolves({ EncryptionConfig: { Type: 'KMS', KeyId: 'alias/xray', Status: 'ACTIVE' } });

    const service = createService(XRayService, 'xray', 'eu-west-1');
    await service.initResources();

    expect(importIds(service)).toEqual(['aws_xray_encryption_config:eu-west-1']);
  });
});
