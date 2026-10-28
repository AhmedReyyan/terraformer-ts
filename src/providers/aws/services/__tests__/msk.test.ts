import { mockClient } from 'aws-sdk-client-mock';
import { KafkaClient, ListClustersV2Command, ListConfigurationsCommand } from '@aws-sdk/client-kafka';
import { MSKService } from '../msk';
import { createService, importIds } from './helpers';

const kafka = mockClient(KafkaClient);
const arn = (kind: string, name: string) => `arn:aws:kafka:us-east-1:123:${kind}/${name}/uuid-1`;

beforeEach(() => kafka.reset());

describe('MSKService', () => {
  it('imports provisioned and serverless clusters by ARN across pages, skipping deleting/failed', async () => {
    kafka.on(ListClustersV2Command).resolvesOnce({
      ClusterInfoList: [{ ClusterName: 'prov', ClusterArn: arn('cluster', 'prov'), ClusterType: 'PROVISIONED', State: 'ACTIVE', Tags: { env: 'prod' } }],
      NextToken: 'n1'
    }).resolvesOnce({
      ClusterInfoList: [
        { ClusterName: 'sls', ClusterArn: arn('cluster', 'sls'), ClusterType: 'SERVERLESS', State: 'ACTIVE' },
        { ClusterName: 'del', ClusterArn: arn('cluster', 'del'), ClusterType: 'PROVISIONED', State: 'DELETING' },
        { ClusterName: 'bad', ClusterArn: arn('cluster', 'bad'), ClusterType: 'PROVISIONED', State: 'FAILED' }
      ]
    });
    kafka.on(ListConfigurationsCommand).resolves({
      Configurations: [
        { Name: 'cfg', Arn: arn('configuration', 'cfg'), State: 'ACTIVE' } as any,
        { Name: 'old', Arn: arn('configuration', 'old'), State: 'DELETING' } as any
      ]
    });

    const service = createService(MSKService, 'msk');
    await service.initResources();

    expect(importIds(service)).toEqual([
      `aws_msk_cluster:${arn('cluster', 'prov')}`,
      `aws_msk_configuration:${arn('configuration', 'cfg')}`,
      `aws_msk_serverless_cluster:${arn('cluster', 'sls')}`
    ]);
    expect(kafka.commandCalls(ListClustersV2Command)[1].args[0].input).toMatchObject({ NextToken: 'n1' });
    expect(service.getResources().find(r => r.type === 'aws_msk_cluster')!.attributes.tags).toEqual({ env: 'prod' });
  });
});
