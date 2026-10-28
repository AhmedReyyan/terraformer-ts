import {
  IoTClient,
  paginateListThings,
  paginateListThingTypes,
  paginateListThingGroups,
  paginateListBillingGroups,
  paginateListTopicRules,
  paginateListTopicRuleDestinations,
  paginateListPolicies,
  paginateListRoleAliases,
  paginateListAuthorizers,
  paginateListDomainConfigurations,
  paginateListProvisioningTemplates
} from '@aws-sdk/client-iot';
import { AwsService } from '../aws-service';

// aws_iot_certificate, aws_iot_thing_principal_attachment and aws_iot_policy_attachment have no
// documented import, so certificates and their attachments are not imported.
export class IoTService extends AwsService {
  async initResources(): Promise<void> {
    const iot = this.client(IoTClient);

    await this.collect('IoT things', async () => {
      for await (const page of paginateListThings({ client: iot }, {})) {
        for (const thing of page.things || []) {
          if (thing.thingName) {
            this.add('aws_iot_thing', thing.thingName, thing.thingName, {
              name: thing.thingName, arn: thing.thingArn, thing_type_name: thing.thingTypeName
            });
          }
        }
      }
    });

    await this.collect('IoT thing types', async () => {
      for await (const page of paginateListThingTypes({ client: iot }, {})) {
        for (const type of page.thingTypes || []) {
          if (type.thingTypeName) {
            this.add('aws_iot_thing_type', type.thingTypeName, type.thingTypeName, {
              name: type.thingTypeName, arn: type.thingTypeArn
            });
          }
        }
      }
    });

    await this.collect('IoT thing groups', async () => {
      for await (const page of paginateListThingGroups({ client: iot }, {})) {
        for (const group of page.thingGroups || []) {
          if (group.groupName) {
            this.add('aws_iot_thing_group', group.groupName, group.groupName, { name: group.groupName, arn: group.groupArn });
          }
        }
      }
    });

    await this.collect('IoT billing groups', async () => {
      for await (const page of paginateListBillingGroups({ client: iot }, {})) {
        for (const group of page.billingGroups || []) {
          if (group.groupName) {
            this.add('aws_iot_billing_group', group.groupName, group.groupName, { name: group.groupName, arn: group.groupArn });
          }
        }
      }
    });

    await this.collect('IoT topic rules', async () => {
      for await (const page of paginateListTopicRules({ client: iot }, {})) {
        for (const rule of page.rules || []) {
          if (rule.ruleName) {
            this.add('aws_iot_topic_rule', rule.ruleName, rule.ruleName, { name: rule.ruleName, arn: rule.ruleArn });
          }
        }
      }
    });

    await this.collect('IoT topic rule destinations', async () => {
      for await (const page of paginateListTopicRuleDestinations({ client: iot }, {})) {
        for (const destination of page.destinationSummaries || []) {
          // Destinations being deleted are skipped.
          if (destination.arn && destination.status !== 'DELETING') {
            this.add('aws_iot_topic_rule_destination', destination.arn, destination.arn.split('/').pop() || destination.arn, {
              arn: destination.arn, status: destination.status
            });
          }
        }
      }
    });

    await this.collect('IoT policies', async () => {
      for await (const page of paginateListPolicies({ client: iot }, {})) {
        for (const policy of page.policies || []) {
          if (policy.policyName) {
            this.add('aws_iot_policy', policy.policyName, policy.policyName, { name: policy.policyName, arn: policy.policyArn });
          }
        }
      }
    });

    await this.collect('IoT role aliases', async () => {
      for await (const page of paginateListRoleAliases({ client: iot }, {})) {
        for (const alias of page.roleAliases || []) {
          this.add('aws_iot_role_alias', alias, alias, { alias });
        }
      }
    });

    await this.collect('IoT authorizers', async () => {
      for await (const page of paginateListAuthorizers({ client: iot }, {})) {
        for (const authorizer of page.authorizers || []) {
          if (authorizer.authorizerName) {
            this.add('aws_iot_authorizer', authorizer.authorizerName, authorizer.authorizerName, {
              name: authorizer.authorizerName, arn: authorizer.authorizerArn
            });
          }
        }
      }
    });

    await this.collect('IoT domain configurations', async () => {
      for await (const page of paginateListDomainConfigurations({ client: iot }, {})) {
        for (const config of page.domainConfigurations || []) {
          const name = config.domainConfigurationName;
          // AWS-managed default endpoints are named "iot:Data-ATS", "iot:Jobs", ...
          if (name && !name.startsWith('iot:')) {
            this.add('aws_iot_domain_configuration', name, name, { name, arn: config.domainConfigurationArn });
          }
        }
      }
    });

    await this.collect('IoT provisioning templates', async () => {
      for await (const page of paginateListProvisioningTemplates({ client: iot }, {})) {
        for (const template of page.templates || []) {
          if (template.templateName) {
            this.add('aws_iot_provisioning_template', template.templateName, template.templateName, {
              name: template.templateName, arn: template.templateArn
            });
          }
        }
      }
    });
  }
}
