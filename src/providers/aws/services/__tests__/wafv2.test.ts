import { mockClient } from 'aws-sdk-client-mock';
import {
  WAFV2Client,
  ListWebACLsCommand,
  ListIPSetsCommand,
  ListRegexPatternSetsCommand,
  ListRuleGroupsCommand,
  ListLoggingConfigurationsCommand,
  ListResourcesForWebACLCommand
} from '@aws-sdk/client-wafv2';
import { WAFv2Service } from '../wafv2';
import { createService, importIds } from './helpers';

const waf = mockClient(WAFV2Client);

const aclArn = 'arn:aws:wafv2:eu-west-1:123456789012:regional/webacl/app/a1';
const fmsArn = 'arn:aws:wafv2:eu-west-1:123456789012:regional/webacl/FMManagedWebACLV2-x/f1';
const albArn = 'arn:aws:elasticloadbalancing:eu-west-1:123456789012:loadbalancer/app/web/123';

beforeEach(() => {
  waf.reset();
  waf.on(ListWebACLsCommand).resolves({ WebACLs: [] });
  waf.on(ListIPSetsCommand).resolves({ IPSets: [] });
  waf.on(ListRegexPatternSetsCommand).resolves({ RegexPatternSets: [] });
  waf.on(ListRuleGroupsCommand).resolves({ RuleGroups: [] });
  waf.on(ListLoggingConfigurationsCommand).resolves({ LoggingConfigurations: [] });
  waf.on(ListResourcesForWebACLCommand).resolves({ ResourceArns: [] });
});

describe('WAFv2Service', () => {
  it('imports REGIONAL resources, logging and associations, skipping Firewall Manager ACLs', async () => {
    waf.on(ListWebACLsCommand, { Scope: 'REGIONAL' }).resolves({
      WebACLs: [
        { Id: 'a1', Name: 'app', ARN: aclArn },
        { Id: 'f1', Name: 'FMManagedWebACLV2-x', ARN: fmsArn }
      ]
    });
    waf.on(ListIPSetsCommand, { Scope: 'REGIONAL' })
      .resolvesOnce({ IPSets: [{ Id: 'i1', Name: 'office' }], NextMarker: 'm' })
      .resolvesOnce({ IPSets: [{ Id: 'i2', Name: 'vpn' }], NextMarker: 'm2' })
      .resolves({ IPSets: [], NextMarker: 'm3' });
    waf.on(ListRegexPatternSetsCommand, { Scope: 'REGIONAL' }).resolves({ RegexPatternSets: [{ Id: 'r1', Name: 'bots' }] });
    waf.on(ListRuleGroupsCommand, { Scope: 'REGIONAL' }).resolves({ RuleGroups: [{ Id: 'g1', Name: 'common' }] });
    waf.on(ListLoggingConfigurationsCommand, { Scope: 'REGIONAL' }).resolves({
      LoggingConfigurations: [
        { ResourceArn: aclArn, LogDestinationConfigs: ['arn:firehose'] },
        { ResourceArn: fmsArn, LogDestinationConfigs: ['arn:firehose'], ManagedByFirewallManager: true }
      ]
    });
    waf.on(ListResourcesForWebACLCommand, { WebACLArn: aclArn, ResourceType: 'APPLICATION_LOAD_BALANCER' }).resolves({ ResourceArns: [albArn] });
    waf.on(ListResourcesForWebACLCommand, { WebACLArn: aclArn, ResourceType: 'AMPLIFY' })
      .rejects(Object.assign(new Error('unsupported'), { name: 'WAFInvalidParameterException' }));

    const service = createService(WAFv2Service, 'wafv2', 'eu-west-1');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_wafv2_ip_set:i1/office/REGIONAL',
      'aws_wafv2_ip_set:i2/vpn/REGIONAL',
      'aws_wafv2_regex_pattern_set:r1/bots/REGIONAL',
      'aws_wafv2_rule_group:g1/common/REGIONAL',
      'aws_wafv2_web_acl:a1/app/REGIONAL',
      `aws_wafv2_web_acl_association:${aclArn},${albArn}`,
      `aws_wafv2_web_acl_logging_configuration:${aclArn}`
    ]);
    expect(waf.commandCalls(ListIPSetsCommand).map(c => c.args[0].input.NextMarker)).toEqual([undefined, 'm', 'm2']);
    // The CLOUDFRONT scope is only read in us-east-1.
    expect(waf.commandCalls(ListWebACLsCommand).map(c => c.args[0].input.Scope)).toEqual(['REGIONAL']);
    expect(waf.commandCalls(ListResourcesForWebACLCommand).every(c => c.args[0].input.WebACLArn === aclArn)).toBe(true);
    expect(service.getWarnings()).toEqual([]);
  });

  it('reads the CLOUDFRONT scope in us-east-1 without associations', async () => {
    waf.on(ListWebACLsCommand, { Scope: 'CLOUDFRONT' }).resolves({
      WebACLs: [{ Id: 'c1', Name: 'cdn', ARN: 'arn:aws:wafv2:us-east-1:123456789012:global/webacl/cdn/c1' }]
    });

    const service = createService(WAFv2Service, 'wafv2', 'us-east-1');
    await service.initResources();

    expect(importIds(service)).toEqual(['aws_wafv2_web_acl:c1/cdn/CLOUDFRONT']);
    expect(waf.commandCalls(ListResourcesForWebACLCommand)).toHaveLength(0);
  });
});
