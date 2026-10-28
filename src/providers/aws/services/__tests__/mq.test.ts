import { mockClient } from 'aws-sdk-client-mock';
import { MqClient, ListBrokersCommand, ListConfigurationsCommand } from '@aws-sdk/client-mq';
import { MQService } from '../mq';
import { createService, importIds } from './helpers';

const mq = mockClient(MqClient);

beforeEach(() => mq.reset());

describe('MQService', () => {
  it('imports brokers and configurations by ID, skipping failed/deleting brokers', async () => {
    mq.on(ListBrokersCommand)
      .resolvesOnce({
        BrokerSummaries: [{ BrokerId: 'b-1', BrokerName: 'main', BrokerState: 'RUNNING', DeploymentMode: 'SINGLE_INSTANCE', EngineType: 'ACTIVEMQ' }],
        NextToken: 'n2'
      })
      .resolvesOnce({
        BrokerSummaries: [
          { BrokerId: 'b-2', BrokerName: 'failed', BrokerState: 'CREATION_FAILED', DeploymentMode: 'SINGLE_INSTANCE', EngineType: 'ACTIVEMQ' },
          { BrokerId: 'b-3', BrokerName: 'going', BrokerState: 'DELETION_IN_PROGRESS', DeploymentMode: 'SINGLE_INSTANCE', EngineType: 'RABBITMQ' }
        ]
      });
    mq.on(ListConfigurationsCommand)
      .resolvesOnce({ Configurations: [{ Id: 'c-1', Name: 'conf-a' } as any], NextToken: 'c2' })
      .resolvesOnce({ Configurations: [{ Id: 'c-2', Name: 'conf-b', Tags: { env: 'prod' } } as any] });

    const service = createService(MQService, 'mq');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_mq_broker:b-1',
      'aws_mq_configuration:c-1',
      'aws_mq_configuration:c-2'
    ]);
    expect(mq.commandCalls(ListConfigurationsCommand)[1].args[0].input).toMatchObject({ NextToken: 'c2' });
    expect(service.getResources().find(r => r.id === 'c-2')?.attributes.tags).toEqual({ env: 'prod' });
    expect(service.getWarnings()).toEqual([]);
  });
});
