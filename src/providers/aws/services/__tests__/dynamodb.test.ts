import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient, ListTablesCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBService } from '../dynamodb';
import { createService, importIds } from './helpers';

const dynamodb = mockClient(DynamoDBClient);

/** Creation time of the global table `global` in each replica region (us-east-1 is the original). */
const created: Record<string, string> = {
  'us-east-1': '2024-01-01T00:00:00Z',
  'eu-west-1': '2024-02-01T00:00:00Z'
};

beforeEach(() => {
  dynamodb.reset();
  dynamodb.on(ListTablesCommand)
    .resolvesOnce({ TableNames: ['orders', 'global'], LastEvaluatedTableName: 'global' })
    .resolves({ TableNames: ['dropping'] });
  dynamodb.on(DescribeTableCommand).callsFake(async (input, getClient) => {
    const region = await getClient().config.region();
    switch (input.TableName) {
      case 'orders':
        return { Table: { TableName: 'orders', TableStatus: 'ACTIVE' } };
      case 'dropping':
        return { Table: { TableName: 'dropping', TableStatus: 'DELETING' } };
      default: {
        const others = Object.keys(created).filter(r => r !== region).map(RegionName => ({ RegionName }));
        return { Table: { TableName: 'global', TableStatus: 'ACTIVE', CreationDateTime: new Date(created[region]), Replicas: others } };
      }
    }
  });
});

describe('DynamoDBService', () => {
  it('imports tables and global tables in the home region of the original replica', async () => {
    const service = createService(DynamoDBService, 'dynamodb', 'us-east-1');
    await service.initResources();

    expect(importIds(service)).toEqual(['aws_dynamodb_table:global', 'aws_dynamodb_table:orders']);
    expect(dynamodb.commandCalls(ListTablesCommand)[1].args[0].input).toMatchObject({ ExclusiveStartTableName: 'global' });
    expect(service.getWarnings()).toEqual([]);
  });

  it('skips global table replicas in other regions', async () => {
    const service = createService(DynamoDBService, 'dynamodb', 'eu-west-1');
    await service.initResources();

    expect(importIds(service)).toEqual(['aws_dynamodb_table:orders']);
  });
});
