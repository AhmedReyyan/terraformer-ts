import { SWFClient, paginateListDomains } from '@aws-sdk/client-swf';
import { AwsService } from '../aws-service';

export class SWFService extends AwsService {
  async initResources(): Promise<void> {
    const swf = this.client(SWFClient);

    await this.collect('SWF domains', async () => {
      // Only registered domains: deprecated domains cannot be managed any more.
      for await (const page of paginateListDomains({ client: swf }, { registrationStatus: 'REGISTERED' })) {
        for (const domain of page.domainInfos || []) {
          if (domain.name) {
            this.add('aws_swf_domain', domain.name, domain.name, { name: domain.name, arn: domain.arn });
          }
        }
      }
    });
  }
}
