import { mockClient } from 'aws-sdk-client-mock';
import {
  OrganizationsClient,
  DescribeOrganizationCommand,
  DescribeResourcePolicyCommand,
  ListAccountsCommand,
  ListDelegatedAdministratorsCommand,
  ListDelegatedServicesForAccountCommand,
  ListOrganizationalUnitsForParentCommand,
  ListPoliciesCommand,
  ListRootsCommand,
  ListTargetsForPolicyCommand
} from '@aws-sdk/client-organizations';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { OrganizationsService } from '../organizations';
import { createService, importIds, notFound } from './helpers';

const organizations = mockClient(OrganizationsClient);
const sts = mockClient(STSClient);

const MANAGEMENT = '111111111111';

beforeEach(() => {
  organizations.reset();
  sts.reset();
  sts.on(GetCallerIdentityCommand).resolves({ Account: MANAGEMENT });
  organizations.on(DescribeOrganizationCommand).resolves({
    Organization: { Id: 'o-abc123', MasterAccountId: MANAGEMENT, FeatureSet: 'ALL' }
  });
  organizations.on(ListAccountsCommand).resolves({});
  organizations.on(ListRootsCommand).resolves({});
  organizations.on(ListOrganizationalUnitsForParentCommand).resolves({});
  organizations.on(ListPoliciesCommand).resolves({});
  organizations.on(ListTargetsForPolicyCommand).resolves({});
  organizations.on(ListDelegatedAdministratorsCommand).resolves({});
  organizations.on(DescribeResourcePolicyCommand).rejects(notFound('ResourcePolicyNotFoundException'));
});

describe('OrganizationsService', () => {
  it('is a global service', () => {
    expect(OrganizationsService.global).toBe(true);
  });

  it('imports the organization, member accounts, the OU tree, policies and their attachments', async () => {
    organizations.on(ListAccountsCommand)
      .resolvesOnce({
        Accounts: [
          { Id: MANAGEMENT, Name: 'management', State: 'ACTIVE' },
          { Id: '222222222222', Name: 'prod', State: 'ACTIVE' }
        ],
        NextToken: 'p2'
      })
      .resolvesOnce({
        Accounts: [
          { Id: '333333333333', Name: 'closed', State: 'SUSPENDED' },
          { Id: '444444444444', Name: 'dev', State: 'ACTIVE' }
        ]
      });
    organizations.on(ListRootsCommand).resolves({
      Roots: [{
        Id: 'r-root',
        PolicyTypes: [
          { Type: 'SERVICE_CONTROL_POLICY', Status: 'ENABLED' },
          { Type: 'TAG_POLICY', Status: 'PENDING_DISABLE' }
        ]
      }]
    });
    organizations.on(ListOrganizationalUnitsForParentCommand, { ParentId: 'r-root' })
      .resolvesOnce({ OrganizationalUnits: [{ Id: 'ou-a', Name: 'Workloads' }], NextToken: 'p2' })
      .resolvesOnce({ OrganizationalUnits: [{ Id: 'ou-b', Name: 'Security' }] });
    organizations.on(ListOrganizationalUnitsForParentCommand, { ParentId: 'ou-a' }).resolves({
      OrganizationalUnits: [{ Id: 'ou-a-prod', Name: 'Prod' }]
    });
    organizations.on(ListPoliciesCommand, { Filter: 'SERVICE_CONTROL_POLICY' }).resolves({
      Policies: [
        { Id: 'p-FullAWSAccess', Name: 'FullAWSAccess', AwsManaged: true },
        { Id: 'p-deny', Name: 'deny-regions', AwsManaged: false }
      ]
    });
    organizations.on(ListTargetsForPolicyCommand, { PolicyId: 'p-deny' }).resolves({
      Targets: [{ TargetId: 'ou-a', Type: 'ORGANIZATIONAL_UNIT' }, { TargetId: '222222222222', Type: 'ACCOUNT' }]
    });
    organizations.on(ListDelegatedAdministratorsCommand).resolves({ DelegatedAdministrators: [{ Id: '444444444444' }] });
    organizations.on(ListDelegatedServicesForAccountCommand, { AccountId: '444444444444' }).resolves({
      DelegatedServices: [{ ServicePrincipal: 'config.amazonaws.com' }]
    });
    organizations.on(DescribeResourcePolicyCommand).resolves({ ResourcePolicy: { ResourcePolicySummary: { Id: 'rp-123' } } });

    const service = createService(OrganizationsService, 'organizations');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_organizations_account:222222222222',
      'aws_organizations_account:444444444444',
      'aws_organizations_delegated_administrator:444444444444/config.amazonaws.com',
      'aws_organizations_organization:o-abc123',
      'aws_organizations_organizational_unit:ou-a',
      'aws_organizations_organizational_unit:ou-a-prod',
      'aws_organizations_organizational_unit:ou-b',
      'aws_organizations_policy:p-deny',
      'aws_organizations_policy_attachment:222222222222:p-deny',
      'aws_organizations_policy_attachment:ou-a:p-deny'
    ].concat(['aws_organizations_resource_policy:rp-123']).sort());
    expect(organizations.commandCalls(ListPoliciesCommand).map(call => call.args[0].input.Filter)).toEqual(['SERVICE_CONTROL_POLICY']);
    expect(organizations.commandCalls(ListTargetsForPolicyCommand)).toHaveLength(1);
    expect(service.getWarnings()).toEqual([]);
  });

  it('turns AWSOrganizationsNotInUseException into a single warning', async () => {
    organizations.on(DescribeOrganizationCommand).rejects(
      Object.assign(new Error('not in an organization'), { name: 'AWSOrganizationsNotInUseException' })
    );

    const service = createService(OrganizationsService, 'organizations');
    await service.initResources();

    expect(importIds(service)).toEqual([]);
    expect(service.getWarnings()).toHaveLength(1);
    expect(service.getWarnings()[0]).toContain('AWSOrganizationsNotInUseException');
    expect(organizations.commandCalls(ListAccountsCommand)).toHaveLength(0);
  });

  it('stops after one warning in a member account that cannot list the organization', async () => {
    sts.on(GetCallerIdentityCommand).resolves({ Account: '999999999999' });
    organizations.on(ListAccountsCommand).rejects(Object.assign(new Error('denied'), { name: 'AccessDeniedException' }));

    const service = createService(OrganizationsService, 'organizations');
    await service.initResources();

    expect(importIds(service)).toEqual([]);
    expect(service.getWarnings()).toHaveLength(1);
    expect(organizations.commandCalls(ListRootsCommand)).toHaveLength(0);
  });
});
