import {
  Route53ResolverClient,
  paginateListResolverEndpoints,
  paginateListResolverRules,
  paginateListResolverRuleAssociations,
  paginateListResolverQueryLogConfigs,
  paginateListResolverQueryLogConfigAssociations,
  paginateListFirewallRuleGroups,
  paginateListFirewallRules,
  paginateListFirewallDomainLists,
  paginateListFirewallRuleGroupAssociations,
  FirewallRuleGroupMetadata
} from '@aws-sdk/client-route53resolver';
import { mapLimit } from '../../../core/provider';
import { AwsService } from '../aws-service';

/** Statuses of objects that are going away or were never created. */
const GONE = new Set(['DELETING', 'FAILED']);

export class Route53ResolverService extends AwsService {
  async initResources(): Promise<void> {
    const resolver = this.client(Route53ResolverClient);

    await this.collect('Route53 Resolver endpoints', async () => {
      for await (const page of paginateListResolverEndpoints({ client: resolver }, {})) {
        for (const endpoint of page.ResolverEndpoints || []) {
          if (GONE.has(endpoint.Status || '')) {
            continue;
          }
          this.add('aws_route53_resolver_endpoint', endpoint.Id!, endpoint.Name || endpoint.Id!, {
            id: endpoint.Id,
            name: endpoint.Name,
            arn: endpoint.Arn,
            direction: endpoint.Direction,
            vpc_id: endpoint.HostVPCId
          });
        }
      }
    });

    await this.collect('Route53 Resolver rules', async () => {
      for await (const page of paginateListResolverRules({ client: resolver }, {})) {
        for (const rule of page.ResolverRules || []) {
          // Skip the rules Route 53 Resolver defines itself (e.g. "Internet Resolver") and rules
          // shared with this account through RAM: they belong to another owner.
          if (
            rule.OwnerId === 'Route 53 Resolver' ||
            rule.Id?.startsWith('rslvr-autodefined-') ||
            rule.ShareStatus === 'SHARED_WITH_ME' ||
            GONE.has(rule.Status || '')
          ) {
            continue;
          }
          this.add('aws_route53_resolver_rule', rule.Id!, rule.Name || rule.DomainName || rule.Id!, {
            id: rule.Id,
            name: rule.Name,
            arn: rule.Arn,
            domain_name: rule.DomainName,
            rule_type: rule.RuleType
          });
        }
      }
    });

    await this.collect('Route53 Resolver rule associations', async () => {
      for await (const page of paginateListResolverRuleAssociations({ client: resolver }, {})) {
        for (const association of page.ResolverRuleAssociations || []) {
          // Associations of the autodefined rules are created by Route 53 Resolver for every VPC.
          if (
            association.Id?.startsWith('rslvr-autodefined-') ||
            association.ResolverRuleId?.startsWith('rslvr-autodefined-') ||
            GONE.has(association.Status || '')
          ) {
            continue;
          }
          const name = association.Name || `${association.ResolverRuleId}_${association.VPCId}`;
          this.add('aws_route53_resolver_rule_association', association.Id!, name, {
            id: association.Id,
            resolver_rule_id: association.ResolverRuleId,
            vpc_id: association.VPCId
          });
        }
      }
    });

    await this.collect('Route53 Resolver query log configs', async () => {
      for await (const page of paginateListResolverQueryLogConfigs({ client: resolver }, {})) {
        for (const config of page.ResolverQueryLogConfigs || []) {
          // Configs shared with this account through RAM belong to another account.
          if (config.ShareStatus === 'SHARED_WITH_ME' || GONE.has(config.Status || '')) {
            continue;
          }
          this.add('aws_route53_resolver_query_log_config', config.Id!, config.Name || config.Id!, {
            id: config.Id,
            name: config.Name,
            arn: config.Arn,
            destination_arn: config.DestinationArn
          });
        }
      }
    });

    await this.collect('Route53 Resolver query log config associations', async () => {
      for await (const page of paginateListResolverQueryLogConfigAssociations({ client: resolver }, {})) {
        for (const association of page.ResolverQueryLogConfigAssociations || []) {
          if (GONE.has(association.Status || '')) {
            continue;
          }
          const name = `${association.ResolverQueryLogConfigId}_${association.ResourceId}`;
          this.add('aws_route53_resolver_query_log_config_association', association.Id!, name, {
            id: association.Id,
            resolver_query_log_config_id: association.ResolverQueryLogConfigId,
            resource_id: association.ResourceId
          });
        }
      }
    });

    await this.collect('Route53 Resolver DNS Firewall domain lists', async () => {
      for await (const page of paginateListFirewallDomainLists({ client: resolver }, {})) {
        for (const list of page.FirewallDomainLists || []) {
          // AWS managed domain lists (ManagedOwnerName set) cannot be managed by Terraform.
          if (list.ManagedOwnerName) {
            continue;
          }
          this.add('aws_route53_resolver_firewall_domain_list', list.Id!, list.Name || list.Id!, {
            id: list.Id,
            name: list.Name,
            arn: list.Arn
          });
        }
      }
    });

    const ruleGroups: FirewallRuleGroupMetadata[] = [];
    await this.collect('Route53 Resolver DNS Firewall rule groups', async () => {
      for await (const page of paginateListFirewallRuleGroups({ client: resolver }, {})) {
        for (const group of page.FirewallRuleGroups || []) {
          // Rule groups shared with this account through RAM belong to another account.
          if (group.ShareStatus === 'SHARED_WITH_ME') {
            continue;
          }
          ruleGroups.push(group);
          this.add('aws_route53_resolver_firewall_rule_group', group.Id!, group.Name || group.Id!, {
            id: group.Id,
            name: group.Name,
            arn: group.Arn
          });
        }
      }
    });

    await mapLimit(ruleGroups, 5, group =>
      this.collect(`Route53 Resolver DNS Firewall rules of ${group.Id}`, async () => {
        for await (const page of paginateListFirewallRules({ client: resolver }, { FirewallRuleGroupId: group.Id! })) {
          for (const rule of page.FirewallRules || []) {
            // Standard rules are keyed by domain list, advanced rules by threat protection ID.
            const target = rule.FirewallDomainListId || rule.FirewallThreatProtectionId;
            if (!target) {
              continue;
            }
            this.add('aws_route53_resolver_firewall_rule', `${group.Id}:${target}`, `${group.Name}_${rule.Name || target}`, {
              name: rule.Name,
              firewall_rule_group_id: group.Id,
              firewall_domain_list_id: rule.FirewallDomainListId,
              firewall_threat_protection_id: rule.FirewallThreatProtectionId
            });
          }
        }
      })
    );

    await this.collect('Route53 Resolver DNS Firewall rule group associations', async () => {
      for await (const page of paginateListFirewallRuleGroupAssociations({ client: resolver }, {})) {
        for (const association of page.FirewallRuleGroupAssociations || []) {
          // Associations created by AWS Firewall Manager (ManagedOwnerName set) are managed by it.
          if (association.ManagedOwnerName || GONE.has(association.Status || '')) {
            continue;
          }
          this.add('aws_route53_resolver_firewall_rule_group_association', association.Id!, association.Name || association.Id!, {
            id: association.Id,
            name: association.Name,
            arn: association.Arn,
            firewall_rule_group_id: association.FirewallRuleGroupId,
            vpc_id: association.VpcId
          });
        }
      }
    });
  }
}
