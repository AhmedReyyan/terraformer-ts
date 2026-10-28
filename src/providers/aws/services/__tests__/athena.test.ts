import { mockClient } from 'aws-sdk-client-mock';
import {
  AthenaClient,
  ListWorkGroupsCommand,
  ListDataCatalogsCommand,
  ListNamedQueriesCommand,
  BatchGetNamedQueryCommand,
  ListPreparedStatementsCommand
} from '@aws-sdk/client-athena';
import { AthenaService } from '../athena';
import { createService, importIds } from './helpers';

const athena = mockClient(AthenaClient);

beforeEach(() => {
  athena.reset();
  athena.on(ListNamedQueriesCommand).resolves({ NamedQueryIds: [] });
  athena.on(ListPreparedStatementsCommand).resolves({ PreparedStatements: [] });
});

describe('AthenaService', () => {
  it('imports workgroups (except primary), custom catalogs, named queries and prepared statements', async () => {
    athena.on(ListWorkGroupsCommand).resolvesOnce({ WorkGroups: [{ Name: 'primary', State: 'ENABLED' }], NextToken: 'w2' })
      .resolvesOnce({ WorkGroups: [{ Name: 'analytics', State: 'ENABLED' }] });
    athena.on(ListDataCatalogsCommand).resolves({
      DataCatalogsSummary: [{ CatalogName: 'AwsDataCatalog', Type: 'GLUE' }, { CatalogName: 'hive', Type: 'HIVE' }]
    });
    athena.on(ListNamedQueriesCommand, { WorkGroup: 'primary' }).resolves({ NamedQueryIds: ['q-1', 'q-2'] });
    athena.on(BatchGetNamedQueryCommand).resolves({
      NamedQueries: [{ NamedQueryId: 'q-1', Name: 'daily', Database: 'db', QueryString: 'select 1' }]
    });
    athena.on(ListPreparedStatementsCommand, { WorkGroup: 'analytics' }).resolves({ PreparedStatements: [{ StatementName: 'stmt' }] });

    const service = createService(AthenaService, 'athena');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_athena_data_catalog:hive',
      'aws_athena_named_query:q-1',
      'aws_athena_named_query:q-2',
      'aws_athena_prepared_statement:analytics/stmt',
      'aws_athena_workgroup:analytics'
    ]);
    expect(athena.commandCalls(ListWorkGroupsCommand)[1].args[0].input).toMatchObject({ NextToken: 'w2' });
    expect(service.getResources().find(r => r.id === 'q-1')!.name).toBe('daily');
    expect(service.getWarnings()).toEqual([]);
  });
});
