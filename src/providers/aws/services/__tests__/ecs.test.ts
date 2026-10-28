import { mockClient } from 'aws-sdk-client-mock';
import {
  ECSClient,
  ListClustersCommand,
  DescribeClustersCommand,
  ListServicesCommand,
  DescribeServicesCommand,
  ListTaskDefinitionFamiliesCommand,
  DescribeTaskDefinitionCommand,
  DescribeCapacityProvidersCommand
} from '@aws-sdk/client-ecs';
import { ECSService } from '../ecs';
import { createService, importIds } from './helpers';

const ecs = mockClient(ECSClient);
const arn = (kind: string, name: string) => `arn:aws:ecs:us-east-1:123456789012:${kind}/${name}`;

beforeEach(() => {
  ecs.reset();
  ecs.on(ListServicesCommand).resolves({ serviceArns: [] });
  ecs.on(ListTaskDefinitionFamiliesCommand).resolves({ families: [] });
  ecs.on(DescribeCapacityProvidersCommand).resolves({ capacityProviders: [] });
});

describe('ECSService', () => {
  it('imports clusters, services, latest task definitions and capacity providers', async () => {
    ecs.on(ListClustersCommand).resolvesOnce({ clusterArns: [arn('cluster', 'app')], nextToken: 't1' })
      .resolvesOnce({ clusterArns: [arn('cluster', 'old'), arn('cluster', 'AWSBatch-ce-1234')] });
    ecs.on(DescribeClustersCommand).resolves({
      clusters: [
        {
          clusterName: 'app', clusterArn: arn('cluster', 'app'), status: 'ACTIVE',
          capacityProviders: ['FARGATE', 'asg-cp', 'mi-cp'], tags: [{ key: 'env', value: 'prod' }]
        },
        { clusterName: 'old', clusterArn: arn('cluster', 'old'), status: 'INACTIVE' },
        { clusterName: 'AWSBatch-ce-1234', clusterArn: arn('cluster', 'AWSBatch-ce-1234'), status: 'ACTIVE' }
      ]
    });
    ecs.on(ListServicesCommand, { cluster: arn('cluster', 'app') })
      .resolvesOnce({ serviceArns: [arn('service', 'app/web')], nextToken: 's1' })
      .resolvesOnce({ serviceArns: [arn('service', 'app/draining')] });
    ecs.on(DescribeServicesCommand).resolves({
      services: [
        { serviceName: 'web', status: 'ACTIVE' },
        { serviceName: 'draining', status: 'DRAINING' }
      ]
    });
    ecs.on(ListTaskDefinitionFamiliesCommand).resolves({ families: ['web'] });
    ecs.on(DescribeTaskDefinitionCommand, { taskDefinition: 'web' }).resolves({
      taskDefinition: { taskDefinitionArn: arn('task-definition', 'web:7'), revision: 7, status: 'ACTIVE' }
    });
    ecs.on(DescribeCapacityProvidersCommand).resolvesOnce({
      capacityProviders: [
        { name: 'FARGATE', type: 'FARGATE', status: 'ACTIVE', capacityProviderArn: arn('capacity-provider', 'FARGATE') }
      ],
      nextToken: 'c1'
    }).resolvesOnce({
      capacityProviders: [
        { name: 'asg-cp', status: 'ACTIVE', capacityProviderArn: arn('capacity-provider', 'asg-cp') },
        { name: 'gone-cp', status: 'INACTIVE', capacityProviderArn: arn('capacity-provider', 'gone-cp') }
      ]
    });
    ecs.on(DescribeCapacityProvidersCommand, { cluster: 'app' }).resolves({
      capacityProviders: [{ name: 'mi-cp', status: 'ACTIVE', cluster: 'app', capacityProviderArn: arn('capacity-provider', 'app/mi-cp') }]
    });

    const service = createService(ECSService, 'ecs');
    await service.initResources();

    expect(importIds(service)).toEqual([
      `aws_ecs_capacity_provider:${arn('capacity-provider', 'app/mi-cp')}`,
      `aws_ecs_capacity_provider:${arn('capacity-provider', 'asg-cp')}`,
      'aws_ecs_cluster:app',
      'aws_ecs_cluster_capacity_providers:app',
      'aws_ecs_service:app/web',
      `aws_ecs_task_definition:${arn('task-definition', 'web:7')}`
    ]);
    expect(service.getResources().find(r => r.type === 'aws_ecs_cluster')!.attributes.tags).toEqual({ env: 'prod' });
    expect(ecs.commandCalls(DescribeCapacityProvidersCommand, { cluster: 'app' })[0].args[0].input)
      .toMatchObject({ capacityProviders: ['mi-cp'] });
    expect(service.getWarnings()).toEqual([]);
  });

  it('does not import cluster capacity providers when none are configured', async () => {
    ecs.on(ListClustersCommand).resolves({ clusterArns: [arn('cluster', 'plain')] });
    ecs.on(DescribeClustersCommand).resolves({ clusters: [{ clusterName: 'plain', status: 'ACTIVE' }] });

    const service = createService(ECSService, 'ecs');
    await service.initResources();

    expect(importIds(service)).toEqual(['aws_ecs_cluster:plain']);
  });
});
