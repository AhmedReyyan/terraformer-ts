import {
  SESClient,
  paginateListIdentities,
  GetIdentityDkimAttributesCommand,
  GetIdentityMailFromDomainAttributesCommand,
  GetIdentityNotificationAttributesCommand,
  ListIdentityPoliciesCommand,
  ListConfigurationSetsCommand,
  DescribeConfigurationSetCommand,
  ListReceiptRuleSetsCommand,
  DescribeReceiptRuleSetCommand,
  DescribeActiveReceiptRuleSetCommand,
  ListReceiptFiltersCommand,
  ListTemplatesCommand
} from '@aws-sdk/client-ses';
import { mapLimit } from '../../../core/provider';
import { AwsService } from '../aws-service';

/** The SES Get*Attributes APIs accept at most 100 identities per call. */
const IDENTITY_BATCH_SIZE = 100;

/** Iterate the pages of a NextToken-paginated API that has no SDK paginator. */
async function* pages<T extends { NextToken?: string }>(fetch: (token?: string) => Promise<T>): AsyncGenerator<T> {
  let token: string | undefined;
  do {
    const page = await fetch(token);
    yield page;
    token = page.NextToken;
  } while (token);
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

/**
 * SES (v1 API) identities and their DKIM, MAIL FROM, notification topic and policy settings,
 * configuration sets with event destinations, receipt rule sets, rules and filters, and templates.
 * Receiving (receipt rules/filters) only exists in some regions; elsewhere it becomes a warning.
 */
export class SESService extends AwsService {
  private ses!: SESClient;

  async initResources(): Promise<void> {
    this.ses = this.client(SESClient);
    const identities: string[] = [];

    await this.collect('SES identities', async () => {
      for await (const page of paginateListIdentities({ client: this.ses }, {})) {
        for (const identity of page.Identities || []) {
          identities.push(identity);
          // ListIdentities returns both kinds; email address identities contain an `@`.
          if (identity.includes('@')) {
            this.add('aws_ses_email_identity', identity, identity, { email: identity });
          } else {
            this.add('aws_ses_domain_identity', identity, identity, { domain: identity });
          }
        }
      }
    });

    await this.loadIdentityAttributes(identities);

    await mapLimit(identities, 5, identity => this.collect(`SES policies of ${identity}`, async () => {
      const response = await this.ses.send(new ListIdentityPoliciesCommand({ Identity: identity }));
      for (const policyName of response.PolicyNames || []) {
        this.add('aws_ses_identity_policy', `${identity}|${policyName}`, `${identity}_${policyName}`, {
          identity, name: policyName
        });
      }
    }));

    const configurationSets: string[] = [];
    await this.collect('SES configuration sets', async () => {
      for await (const page of pages(NextToken => this.ses.send(new ListConfigurationSetsCommand({ NextToken })))) {
        for (const set of page.ConfigurationSets || []) {
          configurationSets.push(set.Name!);
          this.add('aws_ses_configuration_set', set.Name!, set.Name!, { name: set.Name });
        }
      }
    });

    await mapLimit(configurationSets, 5, name => this.collect(`SES event destinations of ${name}`, async () => {
      const response = await this.ses.send(new DescribeConfigurationSetCommand({
        ConfigurationSetName: name, ConfigurationSetAttributeNames: ['eventDestinations']
      }));
      for (const destination of response.EventDestinations || []) {
        this.add('aws_ses_event_destination', `${name}/${destination.Name}`, `${name}_${destination.Name}`, {
          configuration_set_name: name, name: destination.Name
        });
      }
    }));

    await this.loadReceiving();

    await this.collect('SES templates', async () => {
      for await (const page of pages(NextToken => this.ses.send(new ListTemplatesCommand({ NextToken })))) {
        for (const template of page.TemplatesMetadata || []) {
          this.add('aws_ses_template', template.Name!, template.Name!, { name: template.Name });
        }
      }
    });
  }

  /** DKIM, MAIL FROM and notification topics, read in batches of 100 identities. */
  private async loadIdentityAttributes(identities: string[]): Promise<void> {
    const domains = identities.filter(identity => !identity.includes('@'));

    await this.collect('SES DKIM settings', async () => {
      for (const batch of chunks(domains, IDENTITY_BATCH_SIZE)) {
        const response = await this.ses.send(new GetIdentityDkimAttributesCommand({ Identities: batch }));
        for (const [domain, attributes] of Object.entries(response.DkimAttributes || {})) {
          if (attributes.DkimEnabled) {
            this.add('aws_ses_domain_dkim', domain, domain, { domain });
          }
        }
      }
    });

    await this.collect('SES MAIL FROM settings', async () => {
      for (const batch of chunks(identities, IDENTITY_BATCH_SIZE)) {
        const response = await this.ses.send(new GetIdentityMailFromDomainAttributesCommand({ Identities: batch }));
        for (const [identity, attributes] of Object.entries(response.MailFromDomainAttributes || {})) {
          if (attributes.MailFromDomain) {
            this.add('aws_ses_domain_mail_from', identity, identity, { domain: identity, mail_from_domain: attributes.MailFromDomain });
          }
        }
      }
    });

    await this.collect('SES notification topics', async () => {
      for (const batch of chunks(identities, IDENTITY_BATCH_SIZE)) {
        const response = await this.ses.send(new GetIdentityNotificationAttributesCommand({ Identities: batch }));
        for (const [identity, attributes] of Object.entries(response.NotificationAttributes || {})) {
          const topics: Array<[string, string | undefined]> = [
            ['Bounce', attributes.BounceTopic],
            ['Complaint', attributes.ComplaintTopic],
            ['Delivery', attributes.DeliveryTopic]
          ];
          for (const [type, topicArn] of topics) {
            if (topicArn) {
              this.add('aws_ses_identity_notification_topic', `${identity}|${type}`, `${identity}_${type}`, {
                identity, notification_type: type, topic_arn: topicArn
              });
            }
          }
        }
      }
    });
  }

  private async loadReceiving(): Promise<void> {
    const ruleSets: string[] = [];
    await this.collect('SES receipt rule sets', async () => {
      for await (const page of pages(NextToken => this.ses.send(new ListReceiptRuleSetsCommand({ NextToken })))) {
        for (const set of page.RuleSets || []) {
          ruleSets.push(set.Name!);
          this.add('aws_ses_receipt_rule_set', set.Name!, set.Name!, { rule_set_name: set.Name });
        }
      }
    });

    await mapLimit(ruleSets, 5, ruleSetName => this.collect(`SES receipt rules of ${ruleSetName}`, async () => {
      const response = await this.ses.send(new DescribeReceiptRuleSetCommand({ RuleSetName: ruleSetName }));
      for (const rule of response.Rules || []) {
        this.add('aws_ses_receipt_rule', `${ruleSetName}:${rule.Name}`, `${ruleSetName}_${rule.Name}`, {
          rule_set_name: ruleSetName, name: rule.Name
        });
      }
    }));

    if (ruleSets.length > 0) {
      await this.collect('SES active receipt rule set', async () => {
        const response = await this.ses.send(new DescribeActiveReceiptRuleSetCommand({}));
        const name = response.Metadata?.Name;
        if (name) {
          this.add('aws_ses_active_receipt_rule_set', name, `${name}_active`, { rule_set_name: name });
        }
      });
    }

    await this.collect('SES receipt filters', async () => {
      const response = await this.ses.send(new ListReceiptFiltersCommand({}));
      for (const filter of response.Filters || []) {
        this.add('aws_ses_receipt_filter', filter.Name!, filter.Name!, { name: filter.Name });
      }
    });
  }
}
