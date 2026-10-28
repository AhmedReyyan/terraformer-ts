import { CloudTrailClient, paginateListEventDataStores, paginateListTrails } from '@aws-sdk/client-cloudtrail';
import { AwsService } from '../aws-service';

/** The account ID of an ARN (5th field). */
const arnAccount = (arn: string): string => arn.split(':')[4] || '';

export class CloudTrailService extends AwsService {
  async initResources(): Promise<void> {
    const cloudtrail = this.client(CloudTrailClient);
    const accountId = await this.accountId().catch(() => undefined);

    await this.collect('CloudTrail trails', async () => {
      for await (const page of paginateListTrails({ client: cloudtrail }, {})) {
        for (const trail of page.Trails || []) {
          const arn = trail.TrailARN;
          // Multi-region trails are listed in every region (shadow trails): import each only in its home region.
          // Organization trails are also listed in member accounts: import them only in the owning account.
          if (!arn || !trail.Name || trail.HomeRegion !== this.region) continue;
          if (accountId && arnAccount(arn) !== accountId) continue;
          this.add('aws_cloudtrail', arn, trail.Name, { name: trail.Name, arn, home_region: trail.HomeRegion });
        }
      }
    });

    await this.collect('CloudTrail event data stores', async () => {
      for await (const page of paginateListEventDataStores({ client: cloudtrail }, {})) {
        for (const store of page.EventDataStores || []) {
          const arn = store.EventDataStoreArn;
          // Stores pending deletion can only be restored or wait for deletion.
          if (!arn || store.Status === 'PENDING_DELETION') continue;
          if (accountId && arnAccount(arn) !== accountId) continue;
          this.add('aws_cloudtrail_event_data_store', arn, store.Name || arn, { name: store.Name, arn });
        }
      }
    });
  }
}
