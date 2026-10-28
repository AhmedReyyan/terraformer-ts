import { mockClient } from 'aws-sdk-client-mock';
import {
  OpenSearchClient,
  ListDomainNamesCommand,
  DescribeDomainsCommand,
  ListVpcEndpointsCommand
} from '@aws-sdk/client-opensearch';
import { OpenSearchService } from '../opensearch';
import { createService, importIds } from './helpers';

const opensearch = mockClient(OpenSearchClient);

const domain = (name: string, version: string, deleted = false) => ({
  DomainName: name, DomainId: `123/${name}`, ARN: `arn:aws:es:us-east-1:123:domain/${name}`,
  EngineVersion: version, Deleted: deleted, ClusterConfig: {}
});

beforeEach(() => {
  opensearch.reset();
  opensearch.on(ListVpcEndpointsCommand).resolves({ VpcEndpointSummaryList: [] });
});

describe('OpenSearchService', () => {
  it('imports OpenSearch and Elasticsearch domains by name, in batches of 5, skipping deleted ones', async () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'legacy', 'gone'];
    opensearch.on(ListDomainNamesCommand).resolves({ DomainNames: names.map(DomainName => ({ DomainName })) });
    opensearch.on(DescribeDomainsCommand, { DomainNames: ['a', 'b', 'c', 'd', 'e'] }).resolves({
      DomainStatusList: ['a', 'b', 'c', 'd', 'e'].map(n => domain(n, 'OpenSearch_2.11'))
    });
    opensearch.on(DescribeDomainsCommand, { DomainNames: ['legacy', 'gone'] }).resolves({
      DomainStatusList: [domain('legacy', 'Elasticsearch_7.10'), domain('gone', 'OpenSearch_2.11', true)]
    });

    const service = createService(OpenSearchService, 'opensearch');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_elasticsearch_domain:legacy',
      'aws_opensearch_domain:a', 'aws_opensearch_domain:b', 'aws_opensearch_domain:c',
      'aws_opensearch_domain:d', 'aws_opensearch_domain:e'
    ]);
    expect(opensearch.commandCalls(DescribeDomainsCommand)).toHaveLength(2);
    expect(service.getWarnings()).toEqual([]);
  });

  it('imports VPC endpoints across pages and skips deleting ones', async () => {
    opensearch.on(ListDomainNamesCommand).resolves({ DomainNames: [] });
    opensearch.on(ListVpcEndpointsCommand).resolvesOnce({
      VpcEndpointSummaryList: [{ VpcEndpointId: 'aos-1', DomainArn: 'arn:aws:es:us-east-1:123:domain/a', Status: 'ACTIVE' }],
      NextToken: 't1'
    }).resolvesOnce({
      VpcEndpointSummaryList: [
        { VpcEndpointId: 'aos-2', Status: 'ACTIVE' },
        { VpcEndpointId: 'aos-3', Status: 'DELETING' },
        { VpcEndpointId: 'aos-4', Status: 'CREATE_FAILED' }
      ]
    });

    const service = createService(OpenSearchService, 'opensearch');
    await service.initResources();

    expect(importIds(service)).toEqual(['aws_opensearch_vpc_endpoint:aos-1', 'aws_opensearch_vpc_endpoint:aos-2']);
    expect(opensearch.commandCalls(ListVpcEndpointsCommand)[1].args[0].input).toMatchObject({ NextToken: 't1' });
  });
});
