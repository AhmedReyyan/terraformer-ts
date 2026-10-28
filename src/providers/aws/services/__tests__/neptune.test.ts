import { mockClient } from 'aws-sdk-client-mock';
import {
  NeptuneClient,
  DescribeDBClustersCommand,
  DescribeDBClusterEndpointsCommand,
  DescribeDBInstancesCommand,
  DescribeDBClusterParameterGroupsCommand,
  DescribeDBParameterGroupsCommand,
  DescribeDBSubnetGroupsCommand,
  DescribeGlobalClustersCommand
} from '@aws-sdk/client-neptune';
import { NeptuneService } from '../neptune';
import { createService, importIds } from './helpers';

const neptune = mockClient(NeptuneClient);

beforeEach(() => {
  neptune.reset();
  neptune.onAnyCommand().resolves({});
});

describe('NeptuneService', () => {
  it('imports only Neptune objects, skipping defaults and other engines', async () => {
    neptune.on(DescribeDBClustersCommand).resolves({
      DBClusters: [
        { DBClusterIdentifier: 'graph', Engine: 'neptune', DBSubnetGroup: 'graph-net' },
        { DBClusterIdentifier: 'aurora', Engine: 'aurora-postgresql', DBSubnetGroup: 'aurora-net' },
        { DBClusterIdentifier: 'gone', Engine: 'neptune', Status: 'deleting' }
      ]
    });
    neptune.on(DescribeDBClusterEndpointsCommand).resolves({
      DBClusterEndpoints: [
        { DBClusterEndpointIdentifier: 'analytics', DBClusterIdentifier: 'graph', EndpointType: 'CUSTOM' },
        { DBClusterEndpointIdentifier: 'graph-writer', DBClusterIdentifier: 'graph', EndpointType: 'WRITER' },
        { DBClusterEndpointIdentifier: 'aurora-custom', DBClusterIdentifier: 'aurora', EndpointType: 'CUSTOM' }
      ]
    });
    neptune.on(DescribeDBInstancesCommand)
      .resolvesOnce({ DBInstances: [{ DBInstanceIdentifier: 'graph-1', Engine: 'neptune', DBClusterIdentifier: 'graph' }], Marker: 'm' })
      .resolves({
        DBInstances: [
          { DBInstanceIdentifier: 'graph-2', Engine: 'neptune', DBClusterIdentifier: 'graph' },
          { DBInstanceIdentifier: 'pg', Engine: 'postgres' }
        ]
      });
    neptune.on(DescribeDBClusterParameterGroupsCommand).resolves({
      DBClusterParameterGroups: [
        { DBClusterParameterGroupName: 'graph-cluster-params', DBParameterGroupFamily: 'neptune1.3' },
        { DBClusterParameterGroupName: 'default.neptune1.3', DBParameterGroupFamily: 'neptune1.3' },
        { DBClusterParameterGroupName: 'docs-params', DBParameterGroupFamily: 'docdb5.0' }
      ]
    });
    neptune.on(DescribeDBParameterGroupsCommand).resolves({
      DBParameterGroups: [
        { DBParameterGroupName: 'graph-params', DBParameterGroupFamily: 'neptune1.3' },
        { DBParameterGroupName: 'default.neptune1.3', DBParameterGroupFamily: 'neptune1.3' },
        { DBParameterGroupName: 'pg16', DBParameterGroupFamily: 'postgres16' }
      ]
    });
    neptune.on(DescribeDBSubnetGroupsCommand).resolves({
      DBSubnetGroups: [{ DBSubnetGroupName: 'graph-net' }, { DBSubnetGroupName: 'aurora-net' }, { DBSubnetGroupName: 'unused' }]
    });
    neptune.on(DescribeGlobalClustersCommand).resolves({
      GlobalClusters: [
        { GlobalClusterIdentifier: 'graph-global', Engine: 'neptune', GlobalClusterMembers: [
          { DBClusterArn: 'arn:aws:rds:us-west-2:123456789012:cluster:graph', IsWriter: true }
        ] },
        { GlobalClusterIdentifier: 'graph-remote', Engine: 'neptune', GlobalClusterMembers: [
          { DBClusterArn: 'arn:aws:rds:us-east-1:123456789012:cluster:other', IsWriter: true }
        ] }
      ]
    });

    const service = createService(NeptuneService, 'neptune', 'us-west-2');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_neptune_cluster:graph',
      'aws_neptune_cluster_endpoint:graph:analytics',
      'aws_neptune_cluster_instance:graph-1',
      'aws_neptune_cluster_instance:graph-2',
      'aws_neptune_cluster_parameter_group:graph-cluster-params',
      'aws_neptune_global_cluster:graph-global',
      'aws_neptune_parameter_group:graph-params',
      'aws_neptune_subnet_group:graph-net'
    ]);
    expect(neptune.commandCalls(DescribeDBInstancesCommand)[1].args[0].input).toMatchObject({ Marker: 'm' });
    expect(service.getWarnings()).toEqual([]);
  });
});
