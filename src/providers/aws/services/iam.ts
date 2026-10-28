import {
  IAMClient,
  paginateListUsers,
  paginateListGroups,
  paginateListRoles,
  paginateListPolicies,
  paginateListInstanceProfiles,
  paginateListUserPolicies,
  paginateListAttachedUserPolicies,
  paginateListGroupsForUser,
  paginateListRolePolicies,
  paginateListAttachedRolePolicies,
  paginateListGroupPolicies,
  paginateListAttachedGroupPolicies,
  ListOpenIDConnectProvidersCommand,
  ListSAMLProvidersCommand,
  User,
  Group,
  Role
} from '@aws-sdk/client-iam';
import { mapLimit } from '../../../core/provider';
import { AwsService, arnResourceName } from '../aws-service';

/** Paths of roles that AWS creates and manages (service-linked and IAM Identity Center roles). */
const AWS_MANAGED_ROLE_PATHS = ['/aws-service-role/', '/aws-reserved/'];

export class IAMService extends AwsService {
  static readonly global = true;

  private iam!: IAMClient;

  async initResources(): Promise<void> {
    this.iam = this.client(IAMClient);

    const users: User[] = [];
    const groups: Group[] = [];
    const roles: Role[] = [];

    await this.collect('IAM users', async () => {
      for await (const page of paginateListUsers({ client: this.iam }, {})) {
        for (const user of page.Users || []) {
          users.push(user);
          this.add('aws_iam_user', user.UserName!, user.UserName!, { name: user.UserName, path: user.Path, arn: user.Arn });
        }
      }
    });

    await this.collect('IAM groups', async () => {
      for await (const page of paginateListGroups({ client: this.iam }, {})) {
        for (const group of page.Groups || []) {
          groups.push(group);
          this.add('aws_iam_group', group.GroupName!, group.GroupName!, { name: group.GroupName, path: group.Path, arn: group.Arn });
        }
      }
    });

    await this.collect('IAM roles', async () => {
      for await (const page of paginateListRoles({ client: this.iam }, {})) {
        for (const role of page.Roles || []) {
          if (AWS_MANAGED_ROLE_PATHS.some(path => role.Path?.startsWith(path))) {
            continue;
          }
          roles.push(role);
          this.add('aws_iam_role', role.RoleName!, role.RoleName!, { name: role.RoleName, path: role.Path, arn: role.Arn });
        }
      }
    });

    await this.collect('IAM customer managed policies', async () => {
      for await (const page of paginateListPolicies({ client: this.iam }, { Scope: 'Local' })) {
        for (const policy of page.Policies || []) {
          this.add('aws_iam_policy', policy.Arn!, policy.PolicyName!, { name: policy.PolicyName, path: policy.Path, arn: policy.Arn });
        }
      }
    });

    await this.collect('IAM instance profiles', async () => {
      for await (const page of paginateListInstanceProfiles({ client: this.iam }, {})) {
        for (const profile of page.InstanceProfiles || []) {
          this.add('aws_iam_instance_profile', profile.InstanceProfileName!, profile.InstanceProfileName!, {
            name: profile.InstanceProfileName,
            path: profile.Path,
            arn: profile.Arn
          });
        }
      }
    });

    await this.collect('IAM OpenID Connect providers', async () => {
      const response = await this.iam.send(new ListOpenIDConnectProvidersCommand({}));
      for (const provider of response.OpenIDConnectProviderList || []) {
        this.add('aws_iam_openid_connect_provider', provider.Arn!, arnResourceName(provider.Arn!), { arn: provider.Arn });
      }
    });

    await this.collect('IAM SAML providers', async () => {
      const response = await this.iam.send(new ListSAMLProvidersCommand({}));
      for (const provider of response.SAMLProviderList || []) {
        this.add('aws_iam_saml_provider', provider.Arn!, arnResourceName(provider.Arn!), { arn: provider.Arn });
      }
    });

    await mapLimit(users, 5, user => this.collect(`user ${user.UserName} policies`, () => this.loadUserPolicies(user.UserName!)));
    await mapLimit(groups, 5, group => this.collect(`group ${group.GroupName} policies`, () => this.loadGroupPolicies(group.GroupName!)));
    await mapLimit(roles, 5, role => this.collect(`role ${role.RoleName} policies`, () => this.loadRolePolicies(role.RoleName!)));
  }

  private async loadUserPolicies(userName: string): Promise<void> {
    for await (const page of paginateListUserPolicies({ client: this.iam }, { UserName: userName })) {
      for (const policyName of page.PolicyNames || []) {
        this.add('aws_iam_user_policy', `${userName}:${policyName}`, `${userName}_${policyName}`, { user: userName, name: policyName });
      }
    }
    for await (const page of paginateListAttachedUserPolicies({ client: this.iam }, { UserName: userName })) {
      for (const policy of page.AttachedPolicies || []) {
        this.add('aws_iam_user_policy_attachment', `${userName}/${policy.PolicyArn}`, `${userName}_${policy.PolicyName}`, {
          user: userName,
          policy_arn: policy.PolicyArn
        });
      }
    }
    const groupNames: string[] = [];
    for await (const page of paginateListGroupsForUser({ client: this.iam }, { UserName: userName })) {
      for (const group of page.Groups || []) {
        groupNames.push(group.GroupName!);
      }
    }
    if (groupNames.length > 0) {
      // One aws_iam_user_group_membership per user covering all of its groups.
      this.add('aws_iam_user_group_membership', [userName, ...groupNames].join('/'), userName, {
        user: userName,
        groups: groupNames
      });
    }
  }

  private async loadGroupPolicies(groupName: string): Promise<void> {
    for await (const page of paginateListGroupPolicies({ client: this.iam }, { GroupName: groupName })) {
      for (const policyName of page.PolicyNames || []) {
        this.add('aws_iam_group_policy', `${groupName}:${policyName}`, `${groupName}_${policyName}`, { group: groupName, name: policyName });
      }
    }
    for await (const page of paginateListAttachedGroupPolicies({ client: this.iam }, { GroupName: groupName })) {
      for (const policy of page.AttachedPolicies || []) {
        this.add('aws_iam_group_policy_attachment', `${groupName}/${policy.PolicyArn}`, `${groupName}_${policy.PolicyName}`, {
          group: groupName,
          policy_arn: policy.PolicyArn
        });
      }
    }
  }

  private async loadRolePolicies(roleName: string): Promise<void> {
    for await (const page of paginateListRolePolicies({ client: this.iam }, { RoleName: roleName })) {
      for (const policyName of page.PolicyNames || []) {
        this.add('aws_iam_role_policy', `${roleName}:${policyName}`, `${roleName}_${policyName}`, { role: roleName, name: policyName });
      }
    }
    for await (const page of paginateListAttachedRolePolicies({ client: this.iam }, { RoleName: roleName })) {
      for (const policy of page.AttachedPolicies || []) {
        this.add('aws_iam_role_policy_attachment', `${roleName}/${policy.PolicyArn}`, `${roleName}_${policy.PolicyName}`, {
          role: roleName,
          policy_arn: policy.PolicyArn
        });
      }
    }
  }
}
