import { MqClient, paginateListBrokers, ListConfigurationsCommand } from '@aws-sdk/client-mq';
import { AwsService } from '../aws-service';

/** Brokers that failed to create or are being deleted cannot be managed. */
const SKIPPED_BROKER_STATES = new Set(['CREATION_FAILED', 'DELETION_IN_PROGRESS']);

export class MQService extends AwsService {
  async initResources(): Promise<void> {
    const mq = this.client(MqClient);

    await this.collect('MQ brokers', async () => {
      for await (const page of paginateListBrokers({ client: mq }, {})) {
        for (const broker of page.BrokerSummaries || []) {
          if (SKIPPED_BROKER_STATES.has(broker.BrokerState || '')) {
            continue;
          }
          this.add('aws_mq_broker', broker.BrokerId!, broker.BrokerName!, {
            broker_name: broker.BrokerName, arn: broker.BrokerArn, engine_type: broker.EngineType
          });
        }
      }
    });

    await this.collect('MQ configurations', async () => {
      let NextToken: string | undefined;
      do {
        const page = await mq.send(new ListConfigurationsCommand({ NextToken }));
        for (const configuration of page.Configurations || []) {
          this.add('aws_mq_configuration', configuration.Id!, configuration.Name!, {
            name: configuration.Name, arn: configuration.Arn, engine_type: configuration.EngineType,
            tags: configuration.Tags || {}
          });
        }
        NextToken = page.NextToken;
      } while (NextToken);
    });
  }
}
