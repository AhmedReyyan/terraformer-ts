import { mockClient } from 'aws-sdk-client-mock';
import {
  CloudFormationClient,
  ListStackInstancesCommand,
  ListStackSetsCommand,
  ListStacksCommand
} from '@aws-sdk/client-cloudformation';
import { CloudFormationService } from '../cloudformation';
import { createService, importIds } from './helpers';

const cloudformation = mockClient(CloudFormationClient);

const created = new Date();
const validationError = () =>
  Object.assign(new Error('Account used is not a delegated administrator'), { name: 'ValidationError' });

beforeEach(() => {
  cloudformation.reset();
  cloudformation.on(ListStackSetsCommand).resolves({});
  cloudformation.on(ListStackSetsCommand, { CallAs: 'DELEGATED_ADMIN' }).rejects(validationError());
  cloudformation.on(ListStackInstancesCommand).resolves({});
});

describe('CloudFormationService', () => {
  it('imports top-level stacks across pages and skips nested, StackSet, Beanstalk and failed stacks', async () => {
    cloudformation.on(ListStacksCommand)
      .resolvesOnce({
        StackSummaries: [
          { StackName: 'network', StackStatus: 'CREATE_COMPLETE', CreationTime: created },
          { StackName: 'network-Nested-1', StackStatus: 'CREATE_COMPLETE', ParentId: 'arn:parent', CreationTime: created }
        ],
        NextToken: 'p2'
      })
      .resolvesOnce({
        StackSummaries: [
          { StackName: 'StackSet-baseline-1234', StackStatus: 'CREATE_COMPLETE', CreationTime: created },
          { StackName: 'awseb-e-abc-stack', StackStatus: 'UPDATE_COMPLETE', CreationTime: created },
          { StackName: 'broken', StackStatus: 'ROLLBACK_COMPLETE', CreationTime: created },
          { StackName: 'app', StackStatus: 'UPDATE_ROLLBACK_COMPLETE', CreationTime: created }
        ]
      });

    const service = createService(CloudFormationService, 'cloudformation');
    await service.initResources();

    expect(importIds(service)).toEqual(['aws_cloudformation_stack:app', 'aws_cloudformation_stack:network']);
    const calls = cloudformation.commandCalls(ListStacksCommand);
    expect(calls[1].args[0].input).toMatchObject({ NextToken: 'p2' });
    expect(calls[0].args[0].input.StackStatusFilter).not.toContain('DELETE_COMPLETE');
    expect(calls[0].args[0].input.StackStatusFilter).toContain('CREATE_COMPLETE');
    expect(service.getWarnings()).toEqual([]);
  });

  it('imports stack sets and the instances of self-managed ones', async () => {
    cloudformation.on(ListStacksCommand).resolves({});
    cloudformation.on(ListStackSetsCommand, { CallAs: 'SELF' }).resolves({
      Summaries: [
        { StackSetName: 'baseline', PermissionModel: 'SELF_MANAGED', Status: 'ACTIVE' },
        { StackSetName: 'org-guardrails', PermissionModel: 'SERVICE_MANAGED', Status: 'ACTIVE' }
      ]
    });
    cloudformation.on(ListStackInstancesCommand, { StackSetName: 'baseline' })
      .resolvesOnce({ Summaries: [{ Account: '123456789012', Region: 'us-east-1', Status: 'CURRENT' }], NextToken: 'p2' })
      .resolvesOnce({
        Summaries: [
          { Account: '123456789012', Region: 'eu-west-1', Status: 'OUTDATED' },
          { Account: '210987654321', Region: 'eu-west-1', Status: 'INOPERABLE' }
        ]
      });

    const service = createService(CloudFormationService, 'cloudformation');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_cloudformation_stack_set:baseline',
      'aws_cloudformation_stack_set:org-guardrails',
      'aws_cloudformation_stack_set_instance:baseline,123456789012,eu-west-1',
      'aws_cloudformation_stack_set_instance:baseline,123456789012,us-east-1'
    ]);
    expect(cloudformation.commandCalls(ListStackInstancesCommand).map(call => call.args[0].input.StackSetName))
      .toEqual(['baseline', 'baseline']);
    expect(service.getWarnings()).toEqual([]);
  });

  it('uses the DELEGATED_ADMIN import ID for stack sets of a delegated administrator', async () => {
    cloudformation.on(ListStacksCommand).resolves({});
    cloudformation.on(ListStackSetsCommand, { CallAs: 'DELEGATED_ADMIN' }).resolves({
      Summaries: [{ StackSetName: 'org-guardrails', PermissionModel: 'SERVICE_MANAGED', Status: 'ACTIVE' }]
    });

    const service = createService(CloudFormationService, 'cloudformation');
    await service.initResources();

    expect(importIds(service)).toEqual(['aws_cloudformation_stack_set:org-guardrails,DELEGATED_ADMIN']);
    expect(service.getWarnings()).toEqual([]);
  });
});
