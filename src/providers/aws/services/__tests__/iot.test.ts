import { mockClient } from 'aws-sdk-client-mock';
import {
  IoTClient,
  ListThingsCommand,
  ListThingTypesCommand,
  ListThingGroupsCommand,
  ListBillingGroupsCommand,
  ListTopicRulesCommand,
  ListTopicRuleDestinationsCommand,
  ListPoliciesCommand,
  ListRoleAliasesCommand,
  ListAuthorizersCommand,
  ListDomainConfigurationsCommand,
  ListProvisioningTemplatesCommand
} from '@aws-sdk/client-iot';
import { IoTService } from '../iot';
import { createService, importIds } from './helpers';

const iot = mockClient(IoTClient);
const destinationArn = 'arn:aws:iot:eu-west-1:123456789012:ruledestination/vpc/2ce781c8';

beforeEach(() => {
  iot.reset();
  iot.on(ListThingsCommand).resolves({ things: [] });
  iot.on(ListThingTypesCommand).resolves({ thingTypes: [] });
  iot.on(ListThingGroupsCommand).resolves({ thingGroups: [] });
  iot.on(ListBillingGroupsCommand).resolves({ billingGroups: [] });
  iot.on(ListTopicRulesCommand).resolves({ rules: [] });
  iot.on(ListTopicRuleDestinationsCommand).resolves({ destinationSummaries: [] });
  iot.on(ListPoliciesCommand).resolves({ policies: [] });
  iot.on(ListRoleAliasesCommand).resolves({ roleAliases: [] });
  iot.on(ListAuthorizersCommand).resolves({ authorizers: [] });
  iot.on(ListDomainConfigurationsCommand).resolves({ domainConfigurations: [] });
  iot.on(ListProvisioningTemplatesCommand).resolves({ templates: [] });
});

describe('IoTService', () => {
  it('imports every resource type by its documented ID', async () => {
    iot.on(ListThingsCommand)
      .resolvesOnce({ things: [{ thingName: 'sensor-1' }], nextToken: 'p2' })
      .resolvesOnce({ things: [{ thingName: 'sensor-2' }] });
    iot.on(ListThingTypesCommand).resolves({ thingTypes: [{ thingTypeName: 'thermostat' }] });
    iot.on(ListThingGroupsCommand).resolves({ thingGroups: [{ groupName: 'floor-1' }] });
    iot.on(ListBillingGroupsCommand).resolves({ billingGroups: [{ groupName: 'billing' }] });
    iot.on(ListTopicRulesCommand).resolves({ rules: [{ ruleName: 'forward' }] });
    iot.on(ListTopicRuleDestinationsCommand).resolves({
      destinationSummaries: [
        { arn: destinationArn, status: 'ENABLED' },
        { arn: `${destinationArn}-gone`, status: 'DELETING' }
      ]
    });
    iot.on(ListPoliciesCommand).resolves({ policies: [{ policyName: 'PubSub' }] });
    iot.on(ListRoleAliasesCommand).resolves({ roleAliases: ['camera-role'] });
    iot.on(ListAuthorizersCommand).resolves({ authorizers: [{ authorizerName: 'custom-auth' }] });
    iot.on(ListDomainConfigurationsCommand).resolves({
      domainConfigurations: [{ domainConfigurationName: 'iot:Data-ATS' }, { domainConfigurationName: 'my-domain' }]
    });
    iot.on(ListProvisioningTemplatesCommand).resolves({ templates: [{ templateName: 'fleet' }] });

    const service = createService(IoTService, 'iot', 'eu-west-1');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_iot_authorizer:custom-auth',
      'aws_iot_billing_group:billing',
      'aws_iot_domain_configuration:my-domain',
      'aws_iot_policy:PubSub',
      'aws_iot_provisioning_template:fleet',
      'aws_iot_role_alias:camera-role',
      'aws_iot_thing:sensor-1',
      'aws_iot_thing:sensor-2',
      'aws_iot_thing_group:floor-1',
      'aws_iot_thing_type:thermostat',
      'aws_iot_topic_rule:forward',
      `aws_iot_topic_rule_destination:${destinationArn}`
    ]);
    expect(iot.commandCalls(ListThingsCommand)[1].args[0].input).toMatchObject({ nextToken: 'p2' });
    expect(service.getWarnings()).toEqual([]);
  });

  it('records a warning and continues when one listing is denied', async () => {
    iot.on(ListThingsCommand).rejects(Object.assign(new Error('denied'), { name: 'AccessDeniedException' }));
    iot.on(ListPoliciesCommand).resolves({ policies: [{ policyName: 'p' }] });

    const service = createService(IoTService, 'iot', 'eu-west-1');
    await service.initResources();

    expect(importIds(service)).toEqual(['aws_iot_policy:p']);
    expect(service.getWarnings()[0]).toContain('AccessDeniedException');
  });
});
