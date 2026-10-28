import { mockClient } from 'aws-sdk-client-mock';
import {
  SESClient,
  ListIdentitiesCommand,
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
import { SESService } from '../ses';
import { createService, importIds } from './helpers';

const ses = mockClient(SESClient);

beforeEach(() => {
  ses.reset();
  ses.on(ListIdentitiesCommand).resolves({ Identities: [] });
  ses.on(GetIdentityDkimAttributesCommand).resolves({ DkimAttributes: {} });
  ses.on(GetIdentityMailFromDomainAttributesCommand).resolves({ MailFromDomainAttributes: {} });
  ses.on(GetIdentityNotificationAttributesCommand).resolves({ NotificationAttributes: {} });
  ses.on(ListIdentityPoliciesCommand).resolves({ PolicyNames: [] });
  ses.on(ListConfigurationSetsCommand).resolves({});
  ses.on(DescribeConfigurationSetCommand).resolves({});
  ses.on(ListReceiptRuleSetsCommand).resolves({});
  ses.on(DescribeReceiptRuleSetCommand).resolves({});
  ses.on(DescribeActiveReceiptRuleSetCommand).resolves({});
  ses.on(ListReceiptFiltersCommand).resolves({});
  ses.on(ListTemplatesCommand).resolves({});
});

describe('SESService', () => {
  it('imports domain and email identities with their DKIM, MAIL FROM, notification and policy settings', async () => {
    ses.on(ListIdentitiesCommand)
      .resolvesOnce({ Identities: ['example.com'], NextToken: 'n2' })
      .resolvesOnce({ Identities: ['ops@example.com'] });
    ses.on(GetIdentityDkimAttributesCommand).resolves({
      DkimAttributes: { 'example.com': { DkimEnabled: true, DkimVerificationStatus: 'Success' } }
    });
    ses.on(GetIdentityMailFromDomainAttributesCommand).resolves({
      MailFromDomainAttributes: {
        'example.com': { MailFromDomain: 'mail.example.com', MailFromDomainStatus: 'Success', BehaviorOnMXFailure: 'UseDefaultValue' }
      }
    });
    ses.on(GetIdentityNotificationAttributesCommand).resolves({
      NotificationAttributes: {
        'example.com': { BounceTopic: 'arn:aws:sns:us-east-1:123:bounces', ComplaintTopic: undefined, DeliveryTopic: undefined, ForwardingEnabled: true },
        'ops@example.com': { BounceTopic: undefined, ComplaintTopic: undefined, DeliveryTopic: undefined, ForwardingEnabled: true }
      }
    });
    ses.on(ListIdentityPoliciesCommand, { Identity: 'example.com' }).resolves({ PolicyNames: ['sender'] });

    const service = createService(SESService, 'ses');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_ses_domain_dkim:example.com',
      'aws_ses_domain_identity:example.com',
      'aws_ses_domain_mail_from:example.com',
      'aws_ses_email_identity:ops@example.com',
      'aws_ses_identity_notification_topic:example.com|Bounce',
      'aws_ses_identity_policy:example.com|sender'
    ]);
    // DKIM is only requested for domain identities.
    expect(ses.commandCalls(GetIdentityDkimAttributesCommand)[0].args[0].input).toEqual({ Identities: ['example.com'] });
    expect(service.getWarnings()).toEqual([]);
  });

  it('imports configuration sets, event destinations, receipt rules, filters and templates', async () => {
    ses.on(ListConfigurationSetsCommand)
      .resolvesOnce({ ConfigurationSets: [{ Name: 'tracking' }], NextToken: 'c2' })
      .resolvesOnce({ ConfigurationSets: [{ Name: 'plain' }] });
    ses.on(DescribeConfigurationSetCommand, { ConfigurationSetName: 'tracking' }).resolves({
      EventDestinations: [{ Name: 'to-sns', MatchingEventTypes: ['bounce'] }]
    });
    ses.on(ListReceiptRuleSetsCommand).resolves({ RuleSets: [{ Name: 'inbound' }] });
    ses.on(DescribeReceiptRuleSetCommand, { RuleSetName: 'inbound' }).resolves({ Rules: [{ Name: 'store' }, { Name: 'notify' }] });
    ses.on(DescribeActiveReceiptRuleSetCommand).resolves({ Metadata: { Name: 'inbound' } });
    ses.on(ListReceiptFiltersCommand).resolves({ Filters: [{ Name: 'block-spam', IpFilter: { Policy: 'Block', Cidr: '10.0.0.0/8' } }] });
    ses.on(ListTemplatesCommand).resolves({ TemplatesMetadata: [{ Name: 'Welcome' }] });

    const service = createService(SESService, 'ses');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_ses_active_receipt_rule_set:inbound',
      'aws_ses_configuration_set:plain',
      'aws_ses_configuration_set:tracking',
      'aws_ses_event_destination:tracking/to-sns',
      'aws_ses_receipt_filter:block-spam',
      'aws_ses_receipt_rule:inbound:notify',
      'aws_ses_receipt_rule:inbound:store',
      'aws_ses_receipt_rule_set:inbound',
      'aws_ses_template:Welcome'
    ]);
    expect(ses.commandCalls(DescribeConfigurationSetCommand)[0].args[0].input).toMatchObject({
      ConfigurationSetAttributeNames: ['eventDestinations']
    });
    expect(service.getWarnings()).toEqual([]);
  });
});
