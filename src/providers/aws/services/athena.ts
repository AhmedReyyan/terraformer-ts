import {
  AthenaClient,
  paginateListWorkGroups,
  paginateListDataCatalogs,
  paginateListNamedQueries,
  paginateListPreparedStatements,
  BatchGetNamedQueryCommand
} from '@aws-sdk/client-athena';
import { mapLimit } from '../../../core/provider';
import { AwsService } from '../aws-service';

/** Athena workgroups, data catalogs, named queries and prepared statements. */
export class AthenaService extends AwsService {
  async initResources(): Promise<void> {
    const athena = this.client(AthenaClient);
    const workgroups: string[] = [];

    await this.collect('Athena workgroups', async () => {
      for await (const page of paginateListWorkGroups({ client: athena }, {})) {
        for (const workgroup of page.WorkGroups || []) {
          if (!workgroup.Name) {
            continue;
          }
          workgroups.push(workgroup.Name);
          // `primary` is created by AWS in every account and cannot be deleted, so it is
          // treated as a default object. Its named queries and statements are still imported.
          if (workgroup.Name !== 'primary') {
            this.add('aws_athena_workgroup', workgroup.Name, workgroup.Name, {
              name: workgroup.Name,
              state: workgroup.State
            });
          }
        }
      }
    });

    await this.collect('Athena data catalogs', async () => {
      for await (const page of paginateListDataCatalogs({ client: athena }, {})) {
        for (const catalog of page.DataCatalogsSummary || []) {
          // AwsDataCatalog is the built-in Glue catalog of the account.
          if (!catalog.CatalogName || catalog.CatalogName === 'AwsDataCatalog') {
            continue;
          }
          this.add('aws_athena_data_catalog', catalog.CatalogName, catalog.CatalogName, {
            name: catalog.CatalogName,
            type: catalog.Type
          });
        }
      }
    });

    await mapLimit(workgroups, 5, workgroup => this.collect(`Athena named queries of ${workgroup}`, async () => {
      const ids: string[] = [];
      for await (const page of paginateListNamedQueries({ client: athena }, { WorkGroup: workgroup })) {
        ids.push(...(page.NamedQueryIds || []));
      }
      // BatchGetNamedQuery accepts at most 50 IDs; it is only used for readable names.
      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        const { NamedQueries = [] } = await athena.send(new BatchGetNamedQueryCommand({ NamedQueryIds: batch }));
        const names = new Map(NamedQueries.map(query => [query.NamedQueryId, query.Name]));
        for (const id of batch) {
          this.add('aws_athena_named_query', id, names.get(id) || id, { id, name: names.get(id), workgroup });
        }
      }
    }));

    await mapLimit(workgroups, 5, workgroup => this.collect(`Athena prepared statements of ${workgroup}`, async () => {
      for await (const page of paginateListPreparedStatements({ client: athena }, { WorkGroup: workgroup })) {
        for (const statement of page.PreparedStatements || []) {
          if (statement.StatementName) {
            this.add('aws_athena_prepared_statement', `${workgroup}/${statement.StatementName}`,
              `${workgroup}-${statement.StatementName}`, { name: statement.StatementName, workgroup });
          }
        }
      }
    }));
  }
}
