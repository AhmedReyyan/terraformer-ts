import { KinesisClient, paginateListStreams, paginateListStreamConsumers } from '@aws-sdk/client-kinesis';
import { mapLimit } from '../../../core/provider';
import { AwsService } from '../aws-service';

/** Kinesis data streams and their registered enhanced fan-out consumers. */
export class KinesisService extends AwsService {
  async initResources(): Promise<void> {
    const kinesis = this.client(KinesisClient);
    const streams: Array<{ name: string; arn: string }> = [];

    await this.collect('Kinesis streams', async () => {
      for await (const page of paginateListStreams({ client: kinesis }, {})) {
        for (const stream of page.StreamSummaries || []) {
          // Skip streams that are being deleted.
          if (!stream.StreamName || !stream.StreamARN || stream.StreamStatus === 'DELETING') {
            continue;
          }
          streams.push({ name: stream.StreamName, arn: stream.StreamARN });
          this.add('aws_kinesis_stream', stream.StreamName, stream.StreamName, {
            name: stream.StreamName,
            arn: stream.StreamARN
          });
        }
      }
    });

    await mapLimit(streams, 5, stream => this.collect(`Kinesis consumers of ${stream.name}`, async () => {
      for await (const page of paginateListStreamConsumers({ client: kinesis }, { StreamARN: stream.arn })) {
        for (const consumer of page.Consumers || []) {
          // Skip consumers that are being deregistered.
          if (!consumer.ConsumerARN || consumer.ConsumerStatus === 'DELETING') {
            continue;
          }
          this.add('aws_kinesis_stream_consumer', consumer.ConsumerARN, `${stream.name}-${consumer.ConsumerName}`, {
            name: consumer.ConsumerName,
            arn: consumer.ConsumerARN,
            stream_arn: stream.arn
          });
        }
      }
    }));
  }
}
