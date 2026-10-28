import { FirehoseClient, ListDeliveryStreamsCommand, DescribeDeliveryStreamCommand } from '@aws-sdk/client-firehose';
import { mapLimit } from '../../../core/provider';
import { AwsService } from '../aws-service';

const SKIPPED_STATUSES = ['CREATING_FAILED', 'DELETING', 'DELETING_FAILED'];

/** Amazon Data Firehose delivery streams. */
export class FirehoseService extends AwsService {
  async initResources(): Promise<void> {
    const firehose = this.client(FirehoseClient);
    const names: string[] = [];

    await this.collect('Firehose delivery streams', async () => {
      // No SDK paginator: page with ExclusiveStartDeliveryStreamName.
      let start: string | undefined;
      let more = true;
      while (more) {
        const page = await firehose.send(new ListDeliveryStreamsCommand({ ExclusiveStartDeliveryStreamName: start }));
        const pageNames = page.DeliveryStreamNames || [];
        names.push(...pageNames);
        start = pageNames[pageNames.length - 1];
        more = Boolean(page.HasMoreDeliveryStreams && start);
      }
    });

    // The import ID is the ARN, which only DescribeDeliveryStream returns.
    await mapLimit(names, 5, name => this.collect(`Firehose delivery stream ${name}`, async () => {
      const { DeliveryStreamDescription: stream } = await firehose.send(
        new DescribeDeliveryStreamCommand({ DeliveryStreamName: name })
      );
      // Skip streams being deleted or whose creation/deletion failed.
      if (!stream?.DeliveryStreamARN || SKIPPED_STATUSES.includes(stream.DeliveryStreamStatus || '')) {
        return;
      }
      this.add('aws_kinesis_firehose_delivery_stream', stream.DeliveryStreamARN, name, {
        name,
        arn: stream.DeliveryStreamARN
      });
    }));
  }
}
