import {
  WAFV2Client,
  ListWebACLsCommand,
  ListIPSetsCommand,
  ListRegexPatternSetsCommand,
  ListRuleGroupsCommand,
  ListLoggingConfigurationsCommand,
  ListResourcesForWebACLCommand,
  ResourceType,
  Scope
} from '@aws-sdk/client-wafv2';
import { mapLimit } from '../../../core/provider';
import { AwsService } from '../aws-service';

interface Summary { Id?: string; Name?: string; ARN?: string }

/** Web ACLs created by AWS Firewall Manager are managed by FMS policies, not by the account. */
const FMS_PREFIX = 'FMManagedWebACL';

/**
 * WAFv2 web ACLs, IP sets, regex pattern sets, rule groups, logging configurations
 * and web ACL associations. The REGIONAL scope is read in every region; the
 * CLOUDFRONT scope only exists in us-east-1, so it is read only there.
 */
export class WAFv2Service extends AwsService {
  async initResources(): Promise<void> {
    const waf = this.client(WAFV2Client);
    const scopes: Scope[] = this.region === 'us-east-1' ? ['REGIONAL', 'CLOUDFRONT'] : ['REGIONAL'];

    for (const scope of scopes) {
      const label = `WAFv2 ${scope}`;
      const skippedAcls = new Set<string>();
      const regionalAcls: Summary[] = [];

      await this.collect(`${label} web ACLs`, async () => {
        for (const acl of await listAll(marker => waf.send(new ListWebACLsCommand({ Scope: scope, NextMarker: marker })), r => r.WebACLs)) {
          if (acl.Name?.startsWith(FMS_PREFIX)) {
            if (acl.ARN) {
              skippedAcls.add(acl.ARN);
            }
            continue;
          }
          if (this.addScoped('aws_wafv2_web_acl', acl, scope) && scope === 'REGIONAL') {
            regionalAcls.push(acl);
          }
        }
      });

      await this.collect(`${label} IP sets`, async () => {
        for (const set of await listAll(marker => waf.send(new ListIPSetsCommand({ Scope: scope, NextMarker: marker })), r => r.IPSets)) {
          this.addScoped('aws_wafv2_ip_set', set, scope);
        }
      });

      await this.collect(`${label} regex pattern sets`, async () => {
        for (const set of await listAll(marker => waf.send(new ListRegexPatternSetsCommand({ Scope: scope, NextMarker: marker })), r => r.RegexPatternSets)) {
          this.addScoped('aws_wafv2_regex_pattern_set', set, scope);
        }
      });

      await this.collect(`${label} rule groups`, async () => {
        for (const group of await listAll(marker => waf.send(new ListRuleGroupsCommand({ Scope: scope, NextMarker: marker })), r => r.RuleGroups)) {
          this.addScoped('aws_wafv2_rule_group', group, scope);
        }
      });

      await this.collect(`${label} logging configurations`, async () => {
        // The default LogScope (CUSTOMER) excludes configurations owned by Security Lake.
        const configs = await listAll(
          marker => waf.send(new ListLoggingConfigurationsCommand({ Scope: scope, NextMarker: marker })),
          r => r.LoggingConfigurations
        );
        for (const config of configs) {
          if (!config.ResourceArn || config.ManagedByFirewallManager || skippedAcls.has(config.ResourceArn)) {
            continue;
          }
          const name = config.ResourceArn.split('/').slice(-2, -1)[0] || config.ResourceArn;
          this.add('aws_wafv2_web_acl_logging_configuration', config.ResourceArn, name, {
            resource_arn: config.ResourceArn
          });
        }
      });

      // CloudFront distributions reference their web ACL via `web_acl_id`, so
      // associations only exist for REGIONAL web ACLs.
      await mapLimit(regionalAcls, 5, acl => this.collect(`WAFv2 web ACL ${acl.Name} associations`, async () => {
        for (const resourceType of Object.values(ResourceType)) {
          let arns: string[];
          try {
            const response = await waf.send(new ListResourcesForWebACLCommand({ WebACLArn: acl.ARN, ResourceType: resourceType }));
            arns = response.ResourceArns || [];
          } catch (error) {
            // Resource types that are not supported in this region are rejected as invalid parameters.
            if ((error as { name?: string }).name === 'WAFInvalidParameterException') {
              continue;
            }
            throw error;
          }
          for (const arn of arns) {
            this.add('aws_wafv2_web_acl_association', `${acl.ARN},${arn}`, `${acl.Name}-${arn.split(/[:/]/).pop()}`, {
              web_acl_arn: acl.ARN,
              resource_arn: arn
            });
          }
        }
      }));
    }
  }

  /** Web ACLs, IP sets, regex pattern sets and rule groups all import as `ID/name/scope`. */
  private addScoped(type: string, summary: Summary, scope: Scope): boolean {
    if (!summary.Id || !summary.Name) {
      return false;
    }
    this.add(type, `${summary.Id}/${summary.Name}/${scope}`, summary.Name, {
      id: summary.Id,
      name: summary.Name,
      arn: summary.ARN,
      scope
    });
    return true;
  }
}

/** Follow WAFv2 NextMarker pagination until the last page. */
async function listAll<R extends { NextMarker?: string }, T>(
  fetch: (marker: string | undefined) => Promise<R>,
  items: (response: R) => T[] | undefined
): Promise<T[]> {
  const all: T[] = [];
  let marker: string | undefined;
  do {
    const response = await fetch(marker);
    const page = items(response) || [];
    all.push(...page);
    // WAF may return a marker with an empty last page; stop there.
    marker = page.length ? response.NextMarker : undefined;
  } while (marker);
  return all;
}
