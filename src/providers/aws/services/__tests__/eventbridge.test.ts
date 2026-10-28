import { mockClient } from 'aws-sdk-client-mock';
import {
  EventBridgeClient,
  ListEventBusesCommand,
  ListRulesCommand,
  ListTargetsByRuleCommand,
  ListArchivesCommand,
  ListConnectionsCommand,
  ListApiDestinationsCommand
} from '@aws-sdk/client-eventbridge';
import { EventBridgeService } from '../eventbridge';
import { createService, importIds } from './helpers';

const events = mockClient(EventBridgeClient);

beforeEach(() => {
  events.reset();
  events.on(ListRulesCommand).resolves({});
  events.on(ListTargetsByRuleCommand).resolves({});
  events.on(ListArchivesCommand).resolves({});
  events.on(ListConnectionsCommand).resolves({});
  events.on(ListApiDestinationsCommand).resolves({});
});

describe('EventBridgeService', () => {
  it('imports buses, policies, rules and targets with bus-qualified IDs', async () => {
    events.on(ListEventBusesCommand)
      .resolvesOnce({ EventBuses: [{ Name: 'default', Policy: '{}' }], NextToken: 'n2' })
      .resolvesOnce({
        EventBuses: [
          { Name: 'orders' },
          { Name: 'svc-bus', ManagedBy: 'some.amazonaws.com' }
        ]
      });
    events.on(ListRulesCommand, { EventBusName: 'default' }).resolves({
      Rules: [
        { Name: 'nightly', EventBusName: 'default' },
        { Name: 'Managed-Rule', EventBusName: 'default', ManagedBy: 'events.amazonaws.com' }
      ]
    });
    events.on(ListRulesCommand, { EventBusName: 'orders' })
      .resolvesOnce({ Rules: [{ Name: 'created', EventBusName: 'orders' }], NextToken: 'r2' })
      .resolvesOnce({ Rules: [{ Name: 'deleted', EventBusName: 'orders' }] });
    events.on(ListTargetsByRuleCommand, { Rule: 'nightly', EventBusName: 'default' }).resolves({
      Targets: [{ Id: 'lambda', Arn: 'arn:aws:lambda:us-east-1:123:function:f' }]
    });
    events.on(ListTargetsByRuleCommand, { Rule: 'created', EventBusName: 'orders' }).resolves({
      Targets: [{ Id: 'queue', Arn: 'arn:aws:sqs:us-east-1:123:q' }]
    });

    const service = createService(EventBridgeService, 'eventbridge');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_cloudwatch_event_bus:orders',
      'aws_cloudwatch_event_bus_policy:default',
      'aws_cloudwatch_event_rule:nightly',
      'aws_cloudwatch_event_rule:orders/created',
      'aws_cloudwatch_event_rule:orders/deleted',
      'aws_cloudwatch_event_target:nightly/lambda',
      'aws_cloudwatch_event_target:orders/created/queue'
    ]);
    expect(events.commandCalls(ListRulesCommand, { EventBusName: 'svc-bus' })).toHaveLength(0);
    expect(service.getWarnings()).toEqual([]);
  });

  it('imports archives, connections and API destinations by name, skipping unusable states', async () => {
    events.on(ListEventBusesCommand).resolves({ EventBuses: [{ Name: 'default' }] });
    events.on(ListArchivesCommand).resolves({
      Archives: [{ ArchiveName: 'all-events', State: 'ENABLED' }, { ArchiveName: 'broken', State: 'CREATE_FAILED' }]
    });
    events.on(ListConnectionsCommand).resolves({
      Connections: [{ Name: 'partner', ConnectionState: 'AUTHORIZED' }, { Name: 'gone', ConnectionState: 'DELETING' }]
    });
    events.on(ListApiDestinationsCommand).resolves({ ApiDestinations: [{ Name: 'webhook' }] });

    const service = createService(EventBridgeService, 'eventbridge');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_cloudwatch_event_api_destination:webhook',
      'aws_cloudwatch_event_archive:all-events',
      'aws_cloudwatch_event_connection:partner'
    ]);
  });
});
