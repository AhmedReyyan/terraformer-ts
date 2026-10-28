import { mockClient } from 'aws-sdk-client-mock';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import {
  GlueClient,
  GetDatabasesCommand,
  GetTablesCommand,
  GetCrawlersCommand,
  GetJobsCommand,
  GetTriggersCommand,
  GetConnectionsCommand,
  ListWorkflowsCommand,
  GetSecurityConfigurationsCommand,
  GetClassifiersCommand
} from '@aws-sdk/client-glue';
import { GlueService } from '../glue';
import { createService, importIds } from './helpers';

const glue = mockClient(GlueClient);
const sts = mockClient(STSClient);

beforeEach(() => {
  glue.reset();
  sts.reset();
  sts.on(GetCallerIdentityCommand).resolves({ Account: '123456789012' });
  glue.on(GetDatabasesCommand).resolves({ DatabaseList: [] });
  glue.on(GetCrawlersCommand).resolves({ Crawlers: [] });
  glue.on(GetJobsCommand).resolves({ Jobs: [] });
  glue.on(GetTriggersCommand).resolves({ Triggers: [] });
  glue.on(GetConnectionsCommand).resolves({ ConnectionList: [] });
  glue.on(ListWorkflowsCommand).resolves({ Workflows: [] });
  glue.on(GetSecurityConfigurationsCommand).resolves({ SecurityConfigurations: [] });
  glue.on(GetClassifiersCommand).resolves({ Classifiers: [] });
});

describe('GlueService', () => {
  it('imports databases and tables with catalog-qualified IDs, following pagination', async () => {
    glue.on(GetDatabasesCommand).resolvesOnce({
      DatabaseList: [{ Name: 'sales', CatalogId: '123456789012' }], NextToken: 'd2'
    }).resolvesOnce({
      DatabaseList: [
        { Name: 'link', CatalogId: '123456789012', TargetDatabase: { CatalogId: '999999999999', DatabaseName: 'shared' } },
        { Name: 'fed', FederatedDatabase: { Identifier: 'x', ConnectionName: 'c' } }
      ]
    });
    glue.on(GetTablesCommand, { DatabaseName: 'sales' }).resolvesOnce({ TableList: [{ Name: 'orders' }], NextToken: 't2' })
      .resolvesOnce({ TableList: [{ Name: 'items' }] });

    const service = createService(GlueService, 'glue');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_glue_catalog_database:123456789012:fed',
      'aws_glue_catalog_database:123456789012:link',
      'aws_glue_catalog_database:123456789012:sales',
      'aws_glue_catalog_table:123456789012:sales:items',
      'aws_glue_catalog_table:123456789012:sales:orders'
    ]);
    // Tables are not listed for resource links or federated databases.
    expect(glue.commandCalls(GetTablesCommand)).toHaveLength(2);
    expect(glue.commandCalls(GetDatabasesCommand)[1].args[0].input).toMatchObject({ NextToken: 'd2' });
    expect(service.getWarnings()).toEqual([]);
  });

  it('imports crawlers, jobs, triggers, connections, workflows, security configurations and classifiers', async () => {
    glue.on(GetCrawlersCommand).resolves({ Crawlers: [{ Name: 'crawl' }] });
    glue.on(GetJobsCommand).resolves({ Jobs: [{ Name: 'etl' }] });
    glue.on(GetTriggersCommand).resolves({ Triggers: [{ Name: 'nightly', State: 'ACTIVATED' }, { Name: 'gone', State: 'DELETING' }] });
    glue.on(GetConnectionsCommand).resolves({ ConnectionList: [{ Name: 'jdbc' }] });
    glue.on(ListWorkflowsCommand).resolves({ Workflows: ['flow'] });
    glue.on(GetSecurityConfigurationsCommand).resolves({ SecurityConfigurations: [{ Name: 'enc' }] });
    glue.on(GetClassifiersCommand).resolves({ Classifiers: [{ CsvClassifier: { Name: 'csv' } }, { GrokClassifier: { Name: 'grok', Classification: 'x', GrokPattern: 'y' } }] });

    const service = createService(GlueService, 'glue');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_glue_classifier:csv',
      'aws_glue_classifier:grok',
      'aws_glue_connection:123456789012:jdbc',
      'aws_glue_crawler:crawl',
      'aws_glue_job:etl',
      'aws_glue_security_configuration:enc',
      'aws_glue_trigger:nightly',
      'aws_glue_workflow:flow'
    ]);
  });
});
