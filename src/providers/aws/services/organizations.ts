import {
  OrganizationsClient,
  DescribeOrganizationCommand,
  DescribeResourcePolicyCommand,
  PolicyType,
  paginateListAccounts,
  paginateListDelegatedAdministrators,
  paginateListDelegatedServicesForAccount,
  paginateListOrganizationalUnitsForParent,
  paginateListPolicies,
  paginateListRoots,
  paginateListTargetsForPolicy
} from '@aws-sdk/client-organizations';
import { mapLimit } from '../../../core/provider';
import { AwsService, optional } from '../aws-service';

/** Policy types accepted by aws_organizations_policy (`type` argument). */
const TERRAFORM_POLICY_TYPES = new Set<string>([
  'AISERVICES_OPT_OUT_POLICY', 'BACKUP_POLICY', 'BEDROCK_POLICY', 'CHATBOT_POLICY', 'DECLARATIVE_POLICY_EC2',
  'INSPECTOR_POLICY', 'RESOURCE_CONTROL_POLICY', 'S3_POLICY', 'SECURITYHUB_POLICY', 'SERVICE_CONTROL_POLICY',
  'TAG_POLICY', 'UPGRADE_ROLLOUT_POLICY'
]);

/**
 * AWS Organizations. Only readable from the management account or a delegated administrator;
 * from any other account the calls fail and become warnings.
 */
export class OrganizationsService extends AwsService {
  static readonly global = true;

  async initResources(): Promise<void> {
    const organizations = this.client(OrganizationsClient);
    let managementAccountId: string | undefined;
    let isManagementAccount = false;

    await this.collect('AWS organization', async () => {
      const { Organization: organization } = await organizations.send(new DescribeOrganizationCommand({}));
      if (!organization?.Id) return;
      managementAccountId = organization.MasterAccountId;
      // The organization itself can only be managed from its management account.
      isManagementAccount = Boolean(managementAccountId) && managementAccountId === (await this.accountId());
      if (isManagementAccount) {
        this.add('aws_organizations_organization', organization.Id, organization.Id, {
          id: organization.Id,
          arn: organization.Arn,
          feature_set: organization.FeatureSet
        });
      }
    });
    // AWSOrganizationsNotInUseException / AccessDenied: nothing else can be listed.
    if (!managementAccountId) return;

    const warningsBefore = this.warnings.length;
    await this.collect('Organizations accounts', async () => {
      for await (const page of paginateListAccounts({ client: organizations }, {})) {
        for (const account of page.Accounts || []) {
          const state = account.State ?? account.Status;
          // aws_organizations_account manages member accounts: the management account cannot be one.
          // Suspended/closing accounts can no longer be managed.
          if (!account.Id || account.Id === managementAccountId || (state && state !== 'ACTIVE')) continue;
          this.add('aws_organizations_account', account.Id, account.Name || account.Id, {
            id: account.Id,
            name: account.Name,
            email: account.Email,
            arn: account.Arn
          });
        }
      }
    });

    // A plain member account can describe its organization but not list it: one warning is enough.
    if (!isManagementAccount && this.warnings.length > warningsBefore) return;

    const enabledPolicyTypes = new Set<string>();
    await this.collect('Organizations organizational units', async () => {
      const roots: string[] = [];
      for await (const page of paginateListRoots({ client: organizations }, {})) {
        for (const root of page.Roots || []) {
          if (root.Id) roots.push(root.Id);
          for (const type of root.PolicyTypes || []) {
            if (type.Type && type.Status === 'ENABLED') enabledPolicyTypes.add(type.Type);
          }
        }
      }
      // Roots are part of aws_organizations_organization; walk the OU tree below them.
      const walk = async (parentId: string): Promise<void> => {
        const children: string[] = [];
        for await (const page of paginateListOrganizationalUnitsForParent({ client: organizations }, { ParentId: parentId })) {
          for (const unit of page.OrganizationalUnits || []) {
            if (!unit.Id) continue;
            children.push(unit.Id);
            this.add('aws_organizations_organizational_unit', unit.Id, unit.Name || unit.Id, {
              id: unit.Id,
              name: unit.Name,
              arn: unit.Arn,
              parent_id: parentId
            });
          }
        }
        for (const child of children) {
          await walk(child);
        }
      };
      for (const root of roots) {
        await walk(root);
      }
    });

    const policies: string[] = [];
    for (const type of enabledPolicyTypes) {
      if (!TERRAFORM_POLICY_TYPES.has(type)) continue;
      await this.collect(`Organizations ${type} policies`, async () => {
        for await (const page of paginateListPolicies({ client: organizations }, { Filter: type as PolicyType })) {
          for (const policy of page.Policies || []) {
            // AWS-managed policies (FullAWSAccess, ...) cannot be managed, nor are their default attachments imported.
            if (!policy.Id || policy.AwsManaged) continue;
            policies.push(policy.Id);
            this.add('aws_organizations_policy', policy.Id, policy.Name || policy.Id, {
              id: policy.Id,
              name: policy.Name,
              arn: policy.Arn,
              type
            });
          }
        }
      });
    }

    await mapLimit(policies, 5, policyId =>
      this.collect(`targets of Organizations policy ${policyId}`, async () => {
        for await (const page of paginateListTargetsForPolicy({ client: organizations }, { PolicyId: policyId })) {
          for (const target of page.Targets || []) {
            if (target.TargetId) {
              this.add('aws_organizations_policy_attachment', `${target.TargetId}:${policyId}`, `${target.Name || target.TargetId}-${policyId}`, {
                policy_id: policyId,
                target_id: target.TargetId,
                target_type: target.Type
              });
            }
          }
        }
      })
    );

    await this.collect('Organizations delegated administrators', async () => {
      const admins: Array<{ id: string; name?: string }> = [];
      for await (const page of paginateListDelegatedAdministrators({ client: organizations }, {})) {
        for (const admin of page.DelegatedAdministrators || []) {
          if (admin.Id) admins.push({ id: admin.Id, name: admin.Name });
        }
      }
      await mapLimit(admins, 5, async admin => {
        for await (const page of paginateListDelegatedServicesForAccount({ client: organizations }, { AccountId: admin.id })) {
          for (const service of page.DelegatedServices || []) {
            if (service.ServicePrincipal) {
              this.add('aws_organizations_delegated_administrator', `${admin.id}/${service.ServicePrincipal}`,
                `${admin.name || admin.id}-${service.ServicePrincipal}`, {
                  account_id: admin.id,
                  service_principal: service.ServicePrincipal
                });
            }
          }
        }
      });
    });

    await this.collect('Organizations resource policy', async () => {
      // ResourcePolicyNotFoundException when no policy is set.
      const response = await optional(organizations.send(new DescribeResourcePolicyCommand({})));
      const summary = response?.ResourcePolicy?.ResourcePolicySummary;
      if (summary?.Id) {
        this.add('aws_organizations_resource_policy', summary.Id, 'organization', { id: summary.Id, arn: summary.Arn });
      }
    });
  }
}
