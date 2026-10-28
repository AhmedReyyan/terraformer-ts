import {
  GlueClient,
  paginateGetDatabases,
  paginateGetTables,
  paginateGetCrawlers,
  paginateGetJobs,
  paginateGetTriggers,
  paginateGetConnections,
  paginateListWorkflows,
  paginateGetSecurityConfigurations,
  paginateGetClassifiers,
  Database
} from '@aws-sdk/client-glue';
import { mapLimit } from '../../../core/provider';
import { AwsService } from '../aws-service';

/** AWS Glue Data Catalog databases and tables, crawlers, jobs, triggers, connections and workflows. */
export class GlueService extends AwsService {
  async initResources(): Promise<void> {
    const glue = this.client(GlueClient);
    const accountId = await this.accountId();
    const databases: Database[] = [];

    await this.collect('Glue catalog databases', async () => {
      // Without ResourceShareType only databases owned by this account's catalog are listed.
      for await (const page of paginateGetDatabases({ client: glue }, {})) {
        for (const database of page.DatabaseList || []) {
          if (!database.Name) {
            continue;
          }
          // Resource links (target_database) and federated databases are supported by
          // aws_glue_catalog_database, so they are imported like normal databases.
          const catalogId = database.CatalogId || accountId;
          databases.push(database);
          this.add('aws_glue_catalog_database', `${catalogId}:${database.Name}`, database.Name, {
            name: database.Name,
            catalog_id: catalogId
          });
        }
      }
    });

    // Tables of a resource link belong to the target catalog and tables of a federated
    // database live outside the Glue catalog, so only regular databases are listed.
    const regular = databases.filter(database => !database.TargetDatabase && !database.FederatedDatabase);
    await mapLimit(regular, 5, database => this.collect(`Glue tables of ${database.Name}`, async () => {
      const catalogId = database.CatalogId || accountId;
      for await (const page of paginateGetTables({ client: glue }, { CatalogId: catalogId, DatabaseName: database.Name })) {
        for (const table of page.TableList || []) {
          if (!table.Name) {
            continue;
          }
          this.add('aws_glue_catalog_table', `${catalogId}:${database.Name}:${table.Name}`, `${database.Name}-${table.Name}`, {
            name: table.Name,
            database_name: database.Name,
            catalog_id: catalogId
          });
        }
      }
    }));

    await this.collect('Glue crawlers', async () => {
      for await (const page of paginateGetCrawlers({ client: glue }, {})) {
        for (const crawler of page.Crawlers || []) {
          if (crawler.Name) {
            this.add('aws_glue_crawler', crawler.Name, crawler.Name, { name: crawler.Name });
          }
        }
      }
    });

    await this.collect('Glue jobs', async () => {
      for await (const page of paginateGetJobs({ client: glue }, {})) {
        for (const job of page.Jobs || []) {
          if (job.Name) {
            this.add('aws_glue_job', job.Name, job.Name, { name: job.Name });
          }
        }
      }
    });

    await this.collect('Glue triggers', async () => {
      for await (const page of paginateGetTriggers({ client: glue }, {})) {
        for (const trigger of page.Triggers || []) {
          // Skip triggers that are being deleted.
          if (trigger.Name && trigger.State !== 'DELETING') {
            this.add('aws_glue_trigger', trigger.Name, trigger.Name, {
              name: trigger.Name,
              workflow_name: trigger.WorkflowName
            });
          }
        }
      }
    });

    await this.collect('Glue connections', async () => {
      for await (const page of paginateGetConnections({ client: glue }, { HidePassword: true })) {
        for (const connection of page.ConnectionList || []) {
          if (connection.Name) {
            this.add('aws_glue_connection', `${accountId}:${connection.Name}`, connection.Name, {
              name: connection.Name,
              catalog_id: accountId
            });
          }
        }
      }
    });

    await this.collect('Glue workflows', async () => {
      for await (const page of paginateListWorkflows({ client: glue }, {})) {
        for (const name of page.Workflows || []) {
          this.add('aws_glue_workflow', name, name, { name });
        }
      }
    });

    await this.collect('Glue security configurations', async () => {
      for await (const page of paginateGetSecurityConfigurations({ client: glue }, {})) {
        for (const configuration of page.SecurityConfigurations || []) {
          if (configuration.Name) {
            this.add('aws_glue_security_configuration', configuration.Name, configuration.Name, { name: configuration.Name });
          }
        }
      }
    });

    await this.collect('Glue classifiers', async () => {
      // GetClassifiers only returns custom classifiers (built-in ones are not listed).
      for await (const page of paginateGetClassifiers({ client: glue }, {})) {
        for (const classifier of page.Classifiers || []) {
          const name = classifier.GrokClassifier?.Name || classifier.XMLClassifier?.Name ||
            classifier.JsonClassifier?.Name || classifier.CsvClassifier?.Name;
          if (name) {
            this.add('aws_glue_classifier', name, name, { name });
          }
        }
      }
    });
  }
}
