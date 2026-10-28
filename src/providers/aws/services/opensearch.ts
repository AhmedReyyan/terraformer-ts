import {
  OpenSearchClient,
  ListDomainNamesCommand,
  DescribeDomainsCommand,
  ListVpcEndpointsCommand
} from '@aws-sdk/client-opensearch';
import { AwsService } from '../aws-service';

/**
 * OpenSearch Service domains (OpenSearch and legacy Elasticsearch engines) and
 * OpenSearch-managed VPC endpoints. The domain access policy is part of the domain
 * resource (`access_policies`), so aws_opensearch_domain_policy is not imported.
 * OpenSearch Serverless uses a separate SDK client and is not covered here.
 */
export class OpenSearchService extends AwsService {
  async initResources(): Promise<void> {
    const opensearch = this.client(OpenSearchClient);

    await this.collect('OpenSearch domains', async () => {
      // ListDomainNames is not paginated: it returns every domain in the region.
      const { DomainNames = [] } = await opensearch.send(new ListDomainNamesCommand({}));
      const names = DomainNames.map(domain => domain.DomainName).filter((name): name is string => Boolean(name));
      // DescribeDomains accepts at most 5 names per call.
      for (let i = 0; i < names.length; i += 5) {
        const { DomainStatusList = [] } = await opensearch.send(
          new DescribeDomainsCommand({ DomainNames: names.slice(i, i + 5) })
        );
        for (const domain of DomainStatusList) {
          // Skip domains that are being deleted.
          if (!domain.DomainName || domain.Deleted) {
            continue;
          }
          const name = domain.DomainName;
          const version = domain.EngineVersion || '';
          const attributes = { domain_name: name, arn: domain.ARN, engine_version: version };
          if (version.startsWith('Elasticsearch_')) {
            this.add('aws_elasticsearch_domain', name, name, attributes);
          } else {
            this.add('aws_opensearch_domain', name, name, attributes);
          }
        }
      }
    });

    await this.collect('OpenSearch VPC endpoints', async () => {
      let nextToken: string | undefined;
      do {
        const page = await opensearch.send(new ListVpcEndpointsCommand({ NextToken: nextToken }));
        for (const endpoint of page.VpcEndpointSummaryList || []) {
          // Skip endpoints being deleted or whose creation/deletion failed.
          const status = endpoint.Status || '';
          if (!endpoint.VpcEndpointId || status.startsWith('DELET') || status.endsWith('_FAILED')) {
            continue;
          }
          const domain = endpoint.DomainArn?.split('/').pop() || 'domain';
          this.add('aws_opensearch_vpc_endpoint', endpoint.VpcEndpointId, `${domain}-${endpoint.VpcEndpointId}`, {
            id: endpoint.VpcEndpointId,
            domain_arn: endpoint.DomainArn
          });
        }
        nextToken = page.NextToken;
      } while (nextToken);
    });
  }
}
