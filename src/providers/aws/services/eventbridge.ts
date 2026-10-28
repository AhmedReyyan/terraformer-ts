import {
  EventBridgeClient,
  ListEventBusesCommand,
  ListRulesCommand,
  ListTargetsByRuleCommand,
  ListArchivesCommand,
  ListConnectionsCommand,
  ListApiDestinationsCommand,
  Rule
} from '@aws-sdk/client-eventbridge';
import { mapLimit } from '../../../core/provider';
import { AwsService } from '../aws-service';

const DEFAULT_BUS = 'default';

/** Iterate the pages of a NextToken-paginated API (client-eventbridge ships no paginators). */
async function* pages<T extends { NextToken?: string }>(fetch: (token?: string) => Promise<T>): AsyncGenerator<T> {
  let token: string | undefined;
  do {
    const page = await fetch(token);
    yield page;
    token = page.NextToken;
  } while (token);
}

/**
 * EventBridge (CloudWatch Events) buses, bus policies, rules, targets, archives,
 * connections and API destinations. EventBridge Pipes and Scheduler use separate
 * SDKs and are not covered here.
 */
export class EventBridgeService extends AwsService {
  private events!: EventBridgeClient;

  async initResources(): Promise<void> {
    this.events = this.client(EventBridgeClient);
    const busNames: string[] = [];

    await this.collect('EventBridge event buses', async () => {
      for await (const page of pages(NextToken => this.events.send(new ListEventBusesCommand({ NextToken })))) {
        for (const bus of page.EventBuses || []) {
          const name = bus.Name!;
          // Buses created by another AWS service on the account's behalf are owned by that service.
          if (bus.ManagedBy) {
            continue;
          }
          busNames.push(name);
          // The default bus always exists and cannot be created or deleted.
          if (name !== DEFAULT_BUS) {
            this.add('aws_cloudwatch_event_bus', name, name, { name, arn: bus.Arn });
          }
          // The resource policy is a separate resource (aws_cloudwatch_event_bus_policy), also on the default bus.
          if (bus.Policy) {
            this.add('aws_cloudwatch_event_bus_policy', name, `${name}_policy`, { event_bus_name: name });
          }
        }
      }
    });

    const rules: Rule[] = [];
    await mapLimit(busNames, 5, busName => this.collect(`EventBridge rules of bus ${busName}`, async () => {
      for await (const page of pages(NextToken => this.events.send(new ListRulesCommand({ EventBusName: busName, NextToken })))) {
        for (const rule of page.Rules || []) {
          // Managed rules are created and owned by another AWS service (ManagedBy is set).
          if (rule.ManagedBy) {
            continue;
          }
          const bus = rule.EventBusName || busName;
          rules.push({ ...rule, EventBusName: bus });
          // Import ID is `event_bus_name/rule_name`; the bus may be omitted for the default bus.
          const id = bus === DEFAULT_BUS ? rule.Name! : `${bus}/${rule.Name}`;
          this.add('aws_cloudwatch_event_rule', id, rule.Name!, {
            name: rule.Name, arn: rule.Arn, event_bus_name: bus, state: rule.State
          });
        }
      }
    }));

    await mapLimit(rules, 5, rule => this.collect(`EventBridge targets of rule ${rule.Name}`, async () => {
      const bus = rule.EventBusName!;
      for await (const page of pages(NextToken => this.events.send(
        new ListTargetsByRuleCommand({ Rule: rule.Name, EventBusName: bus, NextToken })
      ))) {
        for (const target of page.Targets || []) {
          // Import ID is `event_bus_name/rule/target_id` (`rule/target_id` on the default bus).
          const ruleId = bus === DEFAULT_BUS ? rule.Name! : `${bus}/${rule.Name}`;
          this.add('aws_cloudwatch_event_target', `${ruleId}/${target.Id}`, `${rule.Name}_${target.Id}`, {
            rule: rule.Name, target_id: target.Id, event_bus_name: bus, arn: target.Arn
          });
        }
      }
    }));

    await this.collect('EventBridge archives', async () => {
      for await (const page of pages(NextToken => this.events.send(new ListArchivesCommand({ NextToken })))) {
        for (const archive of page.Archives || []) {
          if (archive.State === 'CREATE_FAILED') {
            continue;
          }
          const name = archive.ArchiveName!;
          this.add('aws_cloudwatch_event_archive', name, name, { name, event_source_arn: archive.EventSourceArn });
        }
      }
    });

    await this.collect('EventBridge connections', async () => {
      for await (const page of pages(NextToken => this.events.send(new ListConnectionsCommand({ NextToken })))) {
        for (const connection of page.Connections || []) {
          if (connection.ConnectionState === 'DELETING') {
            continue;
          }
          const name = connection.Name!;
          this.add('aws_cloudwatch_event_connection', name, name, { name, arn: connection.ConnectionArn });
        }
      }
    });

    await this.collect('EventBridge API destinations', async () => {
      for await (const page of pages(NextToken => this.events.send(new ListApiDestinationsCommand({ NextToken })))) {
        for (const destination of page.ApiDestinations || []) {
          const name = destination.Name!;
          this.add('aws_cloudwatch_event_api_destination', name, name, { name, arn: destination.ApiDestinationArn });
        }
      }
    });
  }
}
