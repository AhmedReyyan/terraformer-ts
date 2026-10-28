import { mockClient } from 'aws-sdk-client-mock';
import {
  Route53ResolverClient,
  ListResolverEndpointsCommand,
  ListResolverRulesCommand,
  ListResolverRuleAssociationsCommand,
  ListResolverQueryLogConfigsCommand,
  ListResolverQueryLogConfigAssociationsCommand,
  ListFirewallDomainListsCommand,
  ListFirewallRuleGroupsCommand,
  ListFirewallRulesCommand,
  ListFirewallRuleGroupAssociationsCommand
} from '@aws-sdk/client-route53resolver';
import { Route53ResolverService } from '../route53resolver';
import { createService, importIds } from './helpers';

const resolver = mockClient(Route53ResolverClient);

beforeEach(() => {
  resolver.reset();
  resolver.on(ListResolverEndpointsCommand).resolves({});
  resolver.on(ListResolverRulesCommand).resolves({});
  resolver.on(ListResolverRuleAssociationsCommand).resolves({});
  resolver.on(ListResolverQueryLogConfigsCommand).resolves({});
  resolver.on(ListResolverQueryLogConfigAssociationsCommand).resolves({});
  resolver.on(ListFirewallDomainListsCommand).resolves({});
  resolver.on(ListFirewallRuleGroupsCommand).resolves({});
  resolver.on(ListFirewallRulesCommand).resolves({});
  resolver.on(ListFirewallRuleGroupAssociationsCommand).resolves({});
});

describe('Route53ResolverService', () => {
  it('is regional', () => {
    expect(Route53ResolverService.global).toBe(false);
  });

  it('imports endpoints, rules and associations and skips autodefined, shared and deleting ones', async () => {
    resolver.on(ListResolverEndpointsCommand).resolvesOnce({
      ResolverEndpoints: [{ Id: 'rslvr-in-1', Name: 'inbound', Status: 'OPERATIONAL', Direction: 'INBOUND' }],
      NextToken: 't2'
    }).resolvesOnce({
      ResolverEndpoints: [
        { Id: 'rslvr-out-2', Name: 'outbound', Status: 'OPERATIONAL', Direction: 'OUTBOUND' },
        { Id: 'rslvr-out-3', Name: 'old', Status: 'DELETING', Direction: 'OUTBOUND' }
      ]
    });
    resolver.on(ListResolverRulesCommand).resolves({
      ResolverRules: [
        { Id: 'rslvr-autodefined-rr-internet-resolver', Name: 'Internet Resolver', RuleType: 'RECURSIVE', OwnerId: 'Route 53 Resolver', Status: 'COMPLETE' },
        { Id: 'rslvr-rr-own', Name: 'corp', DomainName: 'corp.example.com.', RuleType: 'FORWARD', OwnerId: '111111111111', ShareStatus: 'SHARED_BY_ME', Status: 'COMPLETE' },
        { Id: 'rslvr-rr-shared', Name: 'shared', RuleType: 'FORWARD', OwnerId: '222222222222', ShareStatus: 'SHARED_WITH_ME', Status: 'COMPLETE' }
      ]
    });
    resolver.on(ListResolverRuleAssociationsCommand).resolves({
      ResolverRuleAssociations: [
        { Id: 'rslvr-autodefined-assoc-vpc-1-internet-resolver', ResolverRuleId: 'rslvr-autodefined-rr-internet-resolver', VPCId: 'vpc-1', Status: 'COMPLETE' },
        { Id: 'rslvr-rrassoc-1', ResolverRuleId: 'rslvr-rr-shared', VPCId: 'vpc-1', Status: 'COMPLETE' },
        { Id: 'rslvr-rrassoc-2', ResolverRuleId: 'rslvr-rr-own', VPCId: 'vpc-2', Status: 'DELETING' }
      ]
    });
    resolver.on(ListResolverQueryLogConfigsCommand).resolves({
      ResolverQueryLogConfigs: [
        { Id: 'rqlc-own', Name: 'logs', Status: 'CREATED', ShareStatus: 'NOT_SHARED' },
        { Id: 'rqlc-shared', Name: 'shared', Status: 'CREATED', ShareStatus: 'SHARED_WITH_ME' }
      ]
    });
    resolver.on(ListResolverQueryLogConfigAssociationsCommand).resolves({
      ResolverQueryLogConfigAssociations: [
        { Id: 'rqlca-1', ResolverQueryLogConfigId: 'rqlc-own', ResourceId: 'vpc-1', Status: 'ACTIVE' },
        { Id: 'rqlca-2', ResolverQueryLogConfigId: 'rqlc-own', ResourceId: 'vpc-2', Status: 'FAILED' }
      ]
    });

    const service = createService(Route53ResolverService, 'route53resolver');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_route53_resolver_endpoint:rslvr-in-1',
      'aws_route53_resolver_endpoint:rslvr-out-2',
      'aws_route53_resolver_query_log_config:rqlc-own',
      'aws_route53_resolver_query_log_config_association:rqlca-1',
      'aws_route53_resolver_rule:rslvr-rr-own',
      'aws_route53_resolver_rule_association:rslvr-rrassoc-1'
    ]);
    expect(resolver.commandCalls(ListResolverEndpointsCommand)[1].args[0].input).toMatchObject({ NextToken: 't2' });
    expect(service.getWarnings()).toEqual([]);
  });

  it('imports DNS Firewall resources and skips AWS managed and shared ones', async () => {
    resolver.on(ListFirewallDomainListsCommand).resolves({
      FirewallDomainLists: [
        { Id: 'rslvr-fdl-own', Name: 'blocked' },
        { Id: 'rslvr-fdl-aws', Name: 'AWSManagedDomainsMalwareDomainList', ManagedOwnerName: 'Route 53 Resolver DNS Firewall' }
      ]
    });
    resolver.on(ListFirewallRuleGroupsCommand).resolves({
      FirewallRuleGroups: [
        { Id: 'rslvr-frg-own', Name: 'main', ShareStatus: 'NOT_SHARED' },
        { Id: 'rslvr-frg-shared', Name: 'shared', ShareStatus: 'SHARED_WITH_ME' }
      ]
    });
    resolver.on(ListFirewallRulesCommand, { FirewallRuleGroupId: 'rslvr-frg-own' }).resolvesOnce({
      FirewallRules: [{ FirewallRuleGroupId: 'rslvr-frg-own', FirewallDomainListId: 'rslvr-fdl-own', Name: 'block', Priority: 1 }],
      NextToken: 'r2'
    }).resolvesOnce({
      FirewallRules: [{ FirewallRuleGroupId: 'rslvr-frg-own', FirewallThreatProtectionId: 'rslvr-ftp-1', Name: 'dga', Priority: 2 }]
    });
    resolver.on(ListFirewallRuleGroupAssociationsCommand).resolves({
      FirewallRuleGroupAssociations: [
        { Id: 'rslvr-frgassoc-own', Name: 'main-vpc', FirewallRuleGroupId: 'rslvr-frg-own', VpcId: 'vpc-1', Status: 'COMPLETE' },
        { Id: 'rslvr-frgassoc-fms', Name: 'fms', FirewallRuleGroupId: 'rslvr-frg-x', VpcId: 'vpc-1', Status: 'COMPLETE', ManagedOwnerName: 'AWS Firewall Manager' }
      ]
    });

    const service = createService(Route53ResolverService, 'route53resolver');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_route53_resolver_firewall_domain_list:rslvr-fdl-own',
      'aws_route53_resolver_firewall_rule:rslvr-frg-own:rslvr-fdl-own',
      'aws_route53_resolver_firewall_rule:rslvr-frg-own:rslvr-ftp-1',
      'aws_route53_resolver_firewall_rule_group:rslvr-frg-own',
      'aws_route53_resolver_firewall_rule_group_association:rslvr-frgassoc-own'
    ]);
    expect(resolver.commandCalls(ListFirewallRulesCommand, { FirewallRuleGroupId: 'rslvr-frg-shared' })).toHaveLength(0);
    expect(service.getWarnings()).toEqual([]);
  });
});
