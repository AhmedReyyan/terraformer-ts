import { SQSClient, paginateListQueues } from '@aws-sdk/client-sqs';
import { AwsService } from '../aws-service';

export class SQSService extends AwsService {
  async initResources(): Promise<void> {
    const sqs = this.client(SQSClient);

    await this.collect('SQS queues', async () => {
      for await (const page of paginateListQueues({ client: sqs }, {})) {
        for (const url of page.QueueUrls || []) {
          // The queue policy is part of aws_sqs_queue, so aws_sqs_queue_policy is not imported separately.
          const name = url.split('/').pop() || url;
          this.add('aws_sqs_queue', url, name, { name, url });
        }
      }
    });
  }
}
