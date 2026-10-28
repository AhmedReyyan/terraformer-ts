import {
  SFNClient,
  paginateListStateMachines,
  paginateListActivities,
  ListStateMachineAliasesCommand,
  StateMachineListItem
} from '@aws-sdk/client-sfn';
import { mapLimit } from '../../../core/provider';
import { AwsService, arnResourceName } from '../aws-service';

export class StepFunctionsService extends AwsService {
  async initResources(): Promise<void> {
    const sfn = this.client(SFNClient);
    const stateMachines: StateMachineListItem[] = [];

    await this.collect('Step Functions state machines', async () => {
      for await (const page of paginateListStateMachines({ client: sfn }, {})) {
        for (const machine of page.stateMachines || []) {
          stateMachines.push(machine);
          this.add('aws_sfn_state_machine', machine.stateMachineArn!, machine.name!, {
            name: machine.name, arn: machine.stateMachineArn, type: machine.type
          });
        }
      }
    });

    await this.collect('Step Functions activities', async () => {
      for await (const page of paginateListActivities({ client: sfn }, {})) {
        for (const activity of page.activities || []) {
          this.add('aws_sfn_activity', activity.activityArn!, activity.name!, {
            name: activity.name, arn: activity.activityArn
          });
        }
      }
    });

    await mapLimit(stateMachines, 5, machine => this.collect(`Step Functions aliases of ${machine.name}`, async () => {
      let nextToken: string | undefined;
      do {
        const page = await sfn.send(new ListStateMachineAliasesCommand({ stateMachineArn: machine.stateMachineArn, nextToken }));
        for (const alias of page.stateMachineAliases || []) {
          const arn = alias.stateMachineAliasArn!;
          const name = arnResourceName(arn);
          this.add('aws_sfn_alias', arn, `${machine.name}_${name}`, { name, arn, state_machine_arn: machine.stateMachineArn });
        }
        nextToken = page.nextToken;
      } while (nextToken);
    }));
  }
}
