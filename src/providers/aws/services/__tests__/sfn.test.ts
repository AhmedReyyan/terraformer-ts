import { mockClient } from 'aws-sdk-client-mock';
import {
  SFNClient,
  ListStateMachinesCommand,
  ListActivitiesCommand,
  ListStateMachineAliasesCommand
} from '@aws-sdk/client-sfn';
import { StepFunctionsService } from '../sfn';
import { createService, importIds } from './helpers';

const sfn = mockClient(SFNClient);

beforeEach(() => sfn.reset());

const machineArn = 'arn:aws:states:us-east-1:123:stateMachine:orders';

describe('StepFunctionsService', () => {
  it('imports state machines, activities and aliases by ARN', async () => {
    sfn.on(ListStateMachinesCommand)
      .resolvesOnce({ stateMachines: [{ stateMachineArn: machineArn, name: 'orders', type: 'STANDARD', creationDate: new Date() }], nextToken: 'p2' })
      .resolvesOnce({ stateMachines: [] });
    sfn.on(ListActivitiesCommand).resolves({
      activities: [{ activityArn: 'arn:aws:states:us-east-1:123:activity:approve', name: 'approve', creationDate: new Date() }]
    });
    sfn.on(ListStateMachineAliasesCommand)
      .resolvesOnce({ stateMachineAliases: [{ stateMachineAliasArn: `${machineArn}:prod`, creationDate: new Date() }], nextToken: 'a2' })
      .resolvesOnce({ stateMachineAliases: [{ stateMachineAliasArn: `${machineArn}:beta`, creationDate: new Date() }] });

    const service = createService(StepFunctionsService, 'sfn');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_sfn_activity:arn:aws:states:us-east-1:123:activity:approve',
      `aws_sfn_alias:${machineArn}:beta`,
      `aws_sfn_alias:${machineArn}:prod`,
      `aws_sfn_state_machine:${machineArn}`
    ]);
    expect(sfn.commandCalls(ListStateMachinesCommand)).toHaveLength(2);
    expect(sfn.commandCalls(ListStateMachineAliasesCommand)[1].args[0].input).toMatchObject({ nextToken: 'a2' });
    expect(service.getWarnings()).toEqual([]);
  });
});
