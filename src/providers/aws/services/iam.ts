import { BaseService } from '../../../core/provider';
import { TerraformResource, ResourceFilter, ProviderConfig, Logger } from '../../../types';
import { 
  IAMClient, 
  ListUsersCommand, 
  ListGroupsCommand, 
  ListPoliciesCommand, 
  ListRolesCommand, 
  ListInstanceProfilesCommand,
  ListUserPoliciesCommand,
  ListAttachedUserPoliciesCommand,
  ListGroupsForUserCommand,
  ListAccessKeysCommand,
  ListRolePoliciesCommand,
  ListAttachedRolePoliciesCommand,
  ListGroupPoliciesCommand,
  ListAttachedGroupPoliciesCommand,
  PolicyScopeType
} from '@aws-sdk/client-iam';

export class IAMService extends BaseService {
  private client: IAMClient;

  constructor(providerName: string, serviceName: string, config: ProviderConfig, logger: Logger) {
    super(providerName, serviceName, config, logger);
    this.client = new IAMClient({
      region: config.region || 'us-east-1',
      credentials: config.credentials ? {
        accessKeyId: config.credentials.accessKeyId || '',
        secretAccessKey: config.credentials.secretAccessKey || '',
        sessionToken: config.credentials.sessionToken || undefined
      } : undefined
    });
  }

  async initResources(): Promise<void> {
    await this.loadUsers();
    await this.loadGroups();
    await this.loadPolicies();
    await this.loadRoles();
    await this.loadInstanceProfiles();
  }

  private async loadUsers(): Promise<void> {
    try {
      this.log('Loading IAM users...', 'info');
      
      const command = new ListUsersCommand({});
      const response = await this.client.send(command);
      
      let userCount = 0;
      for (const user of response.Users || []) {
        if (user.UserName) {
          const resource = this.createResource(
            user.UserName,
            user.UserId || user.UserName,
            'iam_user',
            {
              name: user.UserName,
              force_destroy: false
            },
            {
              user_id: user.UserId,
              arn: user.Arn,
              path: user.Path,
              create_date: user.CreateDate
            }
          );
          
          this.addResource(resource);
          userCount++;
          
          // Load user policies and attachments
          await this.loadUserPolicies(user.UserName);
          await this.loadUserPolicyAttachments(user.UserName);
          await this.loadUserGroups(user.UserName);
          await this.loadUserAccessKeys(user.UserName, user.UserId);
        }
      }
      
      this.log(`Loaded ${userCount} IAM users`, 'info');
    } catch (error) {
      this.log(`Error loading IAM users: ${error}`, 'error');
      throw error;
    }
  }

  private async loadUserPolicies(userName: string): Promise<void> {
    try {
      const command = new ListUserPoliciesCommand({ UserName: userName });
      const response = await this.client.send(command);
      
      for (const policyName of response.PolicyNames || []) {
        const resource = this.createResource(
          `${userName}:${policyName}`,
          `${userName}_${policyName}`.replace('@', ''),
          'iam_user_policy',
          {},
          {
            user: userName,
            name: policyName
          }
        );
        
        this.addResource(resource);
      }
    } catch (error) {
      this.log(`Error loading user policies for ${userName}: ${error}`, 'debug');
    }
  }

  private async loadUserPolicyAttachments(userName: string): Promise<void> {
    try {
      const command = new ListAttachedUserPoliciesCommand({ UserName: userName });
      const response = await this.client.send(command);
      
      for (const attachedPolicy of response.AttachedPolicies || []) {
        if (attachedPolicy.PolicyArn && attachedPolicy.PolicyName) {
          const resource = this.createResource(
            `${userName}/${attachedPolicy.PolicyArn}`,
            `${userName}_${attachedPolicy.PolicyName}`,
            'iam_user_policy_attachment',
            {
              user: userName,
              policy_arn: attachedPolicy.PolicyArn
            },
            {}
          );
          
          this.addResource(resource);
        }
      }
    } catch (error) {
      this.log(`Error loading user policy attachments for ${userName}: ${error}`, 'debug');
    }
  }

  private async loadUserGroups(userName: string): Promise<void> {
    try {
      const command = new ListGroupsForUserCommand({ UserName: userName });
      const response = await this.client.send(command);
      
      for (const group of response.Groups || []) {
        if (group.GroupName) {
          const resource = this.createResource(
            `${userName}/${group.GroupName}`,
            `${userName}/${group.GroupName}`,
            'iam_user_group_membership',
            {
              user: userName,
              groups: [group.GroupName]
            },
            {}
          );
          
          this.addResource(resource);
        }
      }
    } catch (error) {
      this.log(`Error loading user groups for ${userName}: ${error}`, 'debug');
    }
  }

  private async loadUserAccessKeys(userName: string, userId?: string): Promise<void> {
    try {
      const command = new ListAccessKeysCommand({ UserName: userName });
      const response = await this.client.send(command);
      
      for (const key of response.AccessKeyMetadata || []) {
        if (key.AccessKeyId) {
          const resource = this.createResource(
            key.AccessKeyId,
            key.AccessKeyId,
            'iam_access_key',
            {
              user: userName
            },
            {
              status: key.Status,
              create_date: key.CreateDate
            }
          );
          
          this.addResource(resource);
        }
      }
    } catch (error) {
      this.log(`Error loading access keys for ${userName}: ${error}`, 'debug');
    }
  }

  private async loadGroups(): Promise<void> {
    try {
      this.log('Loading IAM groups...', 'info');
      
      const command = new ListGroupsCommand({});
      const response = await this.client.send(command);
      
      let groupCount = 0;
      for (const group of response.Groups || []) {
        if (group.GroupName) {
          const resource = this.createResource(
            group.GroupName,
            group.GroupName,
            'iam_group',
            {
              name: group.GroupName
            },
            {
              group_id: group.GroupId,
              arn: group.Arn,
              path: group.Path,
              create_date: group.CreateDate
            }
          );
          
          this.addResource(resource);
          groupCount++;
          
          // Load group policies and attachments
          await this.loadGroupPolicies(group.GroupName);
          await this.loadAttachedGroupPolicies(group.GroupName);
        }
      }
      
      this.log(`Loaded ${groupCount} IAM groups`, 'info');
    } catch (error) {
      this.log(`Error loading IAM groups: ${error}`, 'error');
      throw error;
    }
  }

  private async loadGroupPolicies(groupName: string): Promise<void> {
    try {
      const command = new ListGroupPoliciesCommand({ GroupName: groupName });
      const response = await this.client.send(command);
      
      for (const policyName of response.PolicyNames || []) {
        const resource = this.createResource(
          `${groupName}:${policyName}`,
          `${groupName}_${policyName}`,
          'iam_group_policy',
          {},
          {
            group: groupName,
            name: policyName
          }
        );
        
        this.addResource(resource);
      }
    } catch (error) {
      this.log(`Error loading group policies for ${groupName}: ${error}`, 'debug');
    }
  }

  private async loadAttachedGroupPolicies(groupName: string): Promise<void> {
    try {
      const command = new ListAttachedGroupPoliciesCommand({ GroupName: groupName });
      const response = await this.client.send(command);
      
      for (const attachedPolicy of response.AttachedPolicies || []) {
        if (attachedPolicy.PolicyArn && attachedPolicy.PolicyName) {
          // Only include AWS managed policies
          if (attachedPolicy.PolicyArn.includes('arn:aws:iam::aws')) {
            const resource = this.createResource(
              `${groupName}/${attachedPolicy.PolicyArn}`,
              `${groupName}_${attachedPolicy.PolicyName}`,
              'iam_group_policy_attachment',
              {
                group: groupName,
                policy_arn: attachedPolicy.PolicyArn
              },
              {}
            );
            
            this.addResource(resource);
          }
        }
      }
    } catch (error) {
      this.log(`Error loading attached group policies for ${groupName}: ${error}`, 'debug');
    }
  }

  private async loadPolicies(): Promise<void> {
    try {
      this.log('Loading IAM policies...', 'info');
      
      const command = new ListPoliciesCommand({ 
        Scope: PolicyScopeType.Local 
      });
      const response = await this.client.send(command);
      
      let policyCount = 0;
      for (const policy of response.Policies || []) {
        if (policy.PolicyName && policy.Arn) {
          const resource = this.createResource(
            policy.Arn,
            policy.PolicyName,
            'iam_policy',
            {
              name: policy.PolicyName,
              description: policy.Description
            },
            {
              arn: policy.Arn,
              path: policy.Path,
              create_date: policy.CreateDate,
              update_date: policy.UpdateDate
            }
          );
          
          this.addResource(resource);
          policyCount++;
        }
      }
      
      this.log(`Loaded ${policyCount} IAM policies`, 'info');
    } catch (error) {
      this.log(`Error loading IAM policies: ${error}`, 'error');
      throw error;
    }
  }

  private async loadRoles(): Promise<void> {
    try {
      this.log('Loading IAM roles...', 'info');
      
      const command = new ListRolesCommand({});
      const response = await this.client.send(command);
      
      let roleCount = 0;
      for (const role of response.Roles || []) {
        if (role.RoleName) {
          const resource = this.createResource(
            role.RoleName,
            role.RoleName,
            'iam_role',
            {
              name: role.RoleName,
              assume_role_policy: role.AssumeRolePolicyDocument
            },
            {
              arn: role.Arn,
              path: role.Path,
              create_date: role.CreateDate,
              description: role.Description,
              max_session_duration: role.MaxSessionDuration
            }
          );
          
          this.addResource(resource);
          roleCount++;
          
          // Load role policies and attachments
          await this.loadRolePolicies(role.RoleName);
          await this.loadAttachedRolePolicies(role.RoleName);
        }
      }
      
      this.log(`Loaded ${roleCount} IAM roles`, 'info');
    } catch (error) {
      this.log(`Error loading IAM roles: ${error}`, 'error');
      throw error;
    }
  }

  private async loadRolePolicies(roleName: string): Promise<void> {
    try {
      const command = new ListRolePoliciesCommand({ RoleName: roleName });
      const response = await this.client.send(command);
      
      for (const policyName of response.PolicyNames || []) {
        const resource = this.createResource(
          `${roleName}:${policyName}`,
          `${roleName}_${policyName}`,
          'iam_role_policy',
          {},
          {
            role: roleName,
            name: policyName
          }
        );
        
        this.addResource(resource);
      }
    } catch (error) {
      this.log(`Error loading role policies for ${roleName}: ${error}`, 'debug');
    }
  }

  private async loadAttachedRolePolicies(roleName: string): Promise<void> {
    try {
      const command = new ListAttachedRolePoliciesCommand({ RoleName: roleName });
      const response = await this.client.send(command);
      
      for (const attachedPolicy of response.AttachedPolicies || []) {
        if (attachedPolicy.PolicyArn && attachedPolicy.PolicyName) {
          const resource = this.createResource(
            `${roleName}/${attachedPolicy.PolicyArn}`,
            `${roleName}_${attachedPolicy.PolicyName}`,
            'iam_role_policy_attachment',
            {
              role: roleName,
              policy_arn: attachedPolicy.PolicyArn
            },
            {}
          );
          
          this.addResource(resource);
        }
      }
    } catch (error) {
      this.log(`Error loading attached role policies for ${roleName}: ${error}`, 'debug');
    }
  }

  private async loadInstanceProfiles(): Promise<void> {
    try {
      this.log('Loading IAM instance profiles...', 'info');
      
      const command = new ListInstanceProfilesCommand({});
      const response = await this.client.send(command);
      
      let profileCount = 0;
      for (const profile of response.InstanceProfiles || []) {
        if (profile.InstanceProfileName) {
          const resource = this.createResource(
            profile.InstanceProfileName,
            profile.InstanceProfileName,
            'iam_instance_profile',
            {
              name: profile.InstanceProfileName
            },
            {
              arn: profile.Arn,
              path: profile.Path,
              create_date: profile.CreateDate
            }
          );
          
          this.addResource(resource);
          profileCount++;
        }
      }
      
      this.log(`Loaded ${profileCount} IAM instance profiles`, 'info');
    } catch (error) {
      this.log(`Error loading IAM instance profiles: ${error}`, 'error');
      throw error;
    }
  }

  parseFilter(rawFilter: string): ResourceFilter[] {
    const filters: ResourceFilter[] = [];
    
    if (!rawFilter.includes('Name=') && rawFilter.includes('=')) {
      const [serviceName, resourcesId] = rawFilter.split('=');
      filters.push({
        serviceName,
        fieldPath: 'id',
        acceptableValues: resourcesId.split(':'),
        isApplicable: (resourceName: string) => serviceName === '' || serviceName === resourceName
      });
    } else {
      const parts = rawFilter.split(';');
      if (parts.length >= 1) {
        const serviceName = parts[0].startsWith('Type=') ? parts[0].substring(5) : '';
        const fieldPath = parts[1]?.startsWith('Name=') ? parts[1].substring(5) : parts[0];
        const acceptableValues = parts[2]?.startsWith('Value=') ? 
          parts[2].substring(6).split(':') : undefined;

        filters.push({
          serviceName,
          fieldPath,
          acceptableValues: acceptableValues || [],
          isApplicable: (resourceName: string) => serviceName === '' || serviceName === resourceName
        });
      }
    }

    return filters;
  }

  async postConvertHook(): Promise<void> {
    this.log('Running IAM post-conversion hook...', 'debug');
    
    // Post-process resources to format policy documents as heredoc
    for (const resource of this.resources) {
      if (resource.type === 'aws_iam_policy' || 
          resource.type === 'aws_iam_user_policy' || 
          resource.type === 'aws_iam_group_policy' || 
          resource.type === 'aws_iam_role_policy') {
        if (resource.attributes.policy) {
          const policy = this.escapeAwsInterpolation(resource.attributes.policy);
          resource.attributes.policy = `<<POLICY
${policy}
POLICY`;
        }
      } else if (resource.type === 'aws_iam_role' && resource.attributes.assume_role_policy) {
        const policy = this.escapeAwsInterpolation(resource.attributes.assume_role_policy);
        resource.attributes.assume_role_policy = `<<POLICY
${policy}
POLICY`;
      } else if (resource.type === 'aws_iam_instance_profile') {
        // Remove roles field as it's managed separately
        delete resource.attributes.roles;
      }
    }
  }

  private escapeAwsInterpolation(policy: string): string {
    return policy.replace(/\$\{/g, '$${');
  }
}

