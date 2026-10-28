import {
  DynamoDBClient,
  DescribeTableCommand,
  TableDescription,
  paginateListTables
} from '@aws-sdk/client-dynamodb';
import { mapLimit, describeError } from '../../../core/provider';
import { AwsService } from '../aws-service';

/**
 * DynamoDB tables.
 *
 * A global table (version 2019.11.21) appears as a table in every replica region, and
 * aws_dynamodb_table manages all replicas through its `replica` blocks. To import it once,
 * it is imported only in its home region: the replica created first (the original table),
 * ties and unreachable regions resolved by region name. Replica regions skip it.
 * Global tables version 2017.11.29 (aws_dynamodb_global_table) are not imported; their
 * regional tables are imported as normal tables in each region.
 */
export class DynamoDBService extends AwsService {
  async initResources(): Promise<void> {
    const dynamodb = this.client(DynamoDBClient);
    const names: string[] = [];

    await this.collect('DynamoDB tables', async () => {
      for await (const page of paginateListTables({ client: dynamodb }, {})) {
        names.push(...(page.TableNames || []));
      }
    });

    await mapLimit(names, 5, name => this.collect(`DynamoDB table ${name}`, async () => {
      const table = (await dynamodb.send(new DescribeTableCommand({ TableName: name }))).Table;
      if (!table || table.TableStatus === 'DELETING') {
        return;
      }
      if (!(await this.isHomeRegion(table))) {
        this.log(`table ${name} is a replica of a global table owned by another region`, 'debug');
        return;
      }
      this.add('aws_dynamodb_table', name, name, {
        name,
        arn: table.TableArn,
        replica_regions: (table.Replicas || []).map(replica => replica.RegionName).filter(Boolean)
      });
    }));
  }

  private async isHomeRegion(table: TableDescription): Promise<boolean> {
    const otherRegions = [...new Set((table.Replicas || []).map(replica => replica.RegionName))]
      .filter((region): region is string => Boolean(region) && region !== this.region);
    if (otherRegions.length === 0) {
      return true;
    }
    const created: Array<{ region: string; time: number }> = [
      { region: this.region, time: table.CreationDateTime?.getTime() ?? Infinity }
    ];
    await Promise.all(otherRegions.map(async region => {
      let time = Infinity;
      try {
        const replica = await this.client(DynamoDBClient, region).send(new DescribeTableCommand({ TableName: table.TableName }));
        time = replica.Table?.CreationDateTime?.getTime() ?? Infinity;
      } catch (error) {
        this.log(`replica ${table.TableName} in ${region}: ${describeError(error)}`, 'debug');
      }
      created.push({ region, time });
    }));
    created.sort((a, b) => (a.time - b.time) || (a.region < b.region ? -1 : a.region > b.region ? 1 : 0));
    return created[0].region === this.region;
  }
}
