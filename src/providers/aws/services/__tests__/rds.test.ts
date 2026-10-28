import { mockClient } from 'aws-sdk-client-mock';
import {
  RDSClient,
  DescribeDBClustersCommand,
  DescribeDBClusterEndpointsCommand,
  DescribeDBInstancesCommand,
  DescribeDBSubnetGroupsCommand,
  DescribeDBParameterGroupsCommand,
  DescribeDBClusterParameterGroupsCommand,
  DescribeOptionGroupsCommand,
  DescribeEventSubscriptionsCommand,
  DescribeDBProxiesCommand,
  DescribeDBProxyTargetsCommand,
  DescribeDBProxyEndpointsCommand,
  DescribeGlobalClustersCommand
} from '@aws-sdk/client-rds';
import { RDSService, subnetGroupOwners } from '../rds';
import { createService, importIds } from './helpers';

const rds = mockClient(RDSClient);

beforeEach(() => {
  rds.reset();
  rds.onAnyCommand().resolves({});
});

describe('RDSService', () => {
  it('imports instances, Aurora clusters and their members, excluding DocumentDB/Neptune', async () => {
    rds.on(DescribeDBClustersCommand).resolves({
      DBClusters: [
        { DBClusterIdentifier: 'aurora', Engine: 'aurora-postgresql', DBSubnetGroup: 'shared', TagList: [{ Key: 'env', Value: 'prod' }] },
        { DBClusterIdentifier: 'maz', Engine: 'mysql', DBSubnetGroup: 'shared' },
        { DBClusterIdentifier: 'docs', Engine: 'docdb', DBSubnetGroup: 'docdb-only' },
        { DBClusterIdentifier: 'graph', Engine: 'neptune', DBSubnetGroup: 'neptune-only' },
        { DBClusterIdentifier: 'gone', Engine: 'aurora-mysql', Status: 'deleting' }
      ]
    });
    rds.on(DescribeDBInstancesCommand)
      .resolvesOnce({
        DBInstances: [
          { DBInstanceIdentifier: 'standalone', Engine: 'postgres', DBSubnetGroup: { DBSubnetGroupName: 'mixed' } },
          { DBInstanceIdentifier: 'aurora-1', Engine: 'aurora-postgresql', DBClusterIdentifier: 'aurora' }
        ],
        Marker: 'next'
      })
      .resolves({
        DBInstances: [
          { DBInstanceIdentifier: 'maz-1', Engine: 'mysql', DBClusterIdentifier: 'maz' },
          { DBInstanceIdentifier: 'docs-1', Engine: 'docdb', DBClusterIdentifier: 'docs' },
          { DBInstanceIdentifier: 'graph-1', Engine: 'neptune', DBClusterIdentifier: 'graph',
            DBSubnetGroup: { DBSubnetGroupName: 'mixed' } },
          { DBInstanceIdentifier: 'dying', Engine: 'mysql', DBInstanceStatus: 'deleting' }
        ]
      });
    rds.on(DescribeDBClusterEndpointsCommand).resolves({
      DBClusterEndpoints: [
        { DBClusterEndpointIdentifier: 'aurora-reporting', DBClusterIdentifier: 'aurora', EndpointType: 'CUSTOM' },
        { DBClusterEndpointIdentifier: 'aurora.cluster-ro', DBClusterIdentifier: 'aurora', EndpointType: 'READER' },
        { DBClusterEndpointIdentifier: 'graph-custom', DBClusterIdentifier: 'graph', EndpointType: 'CUSTOM' }
      ]
    });
    rds.on(DescribeDBSubnetGroupsCommand).resolves({
      DBSubnetGroups: ['default', 'shared', 'mixed', 'unused', 'docdb-only', 'neptune-only'].map(DBSubnetGroupName => ({ DBSubnetGroupName }))
    });

    const service = createService(RDSService, 'rds', 'eu-west-1');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_db_instance:standalone',
      'aws_db_subnet_group:mixed',
      'aws_db_subnet_group:shared',
      'aws_db_subnet_group:unused',
      'aws_rds_cluster:aurora',
      'aws_rds_cluster:maz',
      'aws_rds_cluster_endpoint:aurora-reporting',
      'aws_rds_cluster_instance:aurora-1'
    ]);
    expect(rds.commandCalls(DescribeDBInstancesCommand)[1].args[0].input).toMatchObject({ Marker: 'next' });
    expect(service.getResources().find(r => r.id === 'aurora')?.attributes.tags).toEqual({ env: 'prod' });
    expect(service.getWarnings()).toEqual([]);
  });

  it('imports groups, subscriptions and proxies, skipping defaults and other engines', async () => {
    rds.on(DescribeDBParameterGroupsCommand).resolves({
      DBParameterGroups: [
        { DBParameterGroupName: 'pg16', DBParameterGroupFamily: 'postgres16' },
        { DBParameterGroupName: 'default.postgres16', DBParameterGroupFamily: 'postgres16' },
        { DBParameterGroupName: 'graph-params', DBParameterGroupFamily: 'neptune1.3' }
      ]
    });
    rds.on(DescribeDBClusterParameterGroupsCommand).resolves({
      DBClusterParameterGroups: [
        { DBClusterParameterGroupName: 'aurora-params', DBParameterGroupFamily: 'aurora-mysql8.0' },
        { DBClusterParameterGroupName: 'default.aurora-mysql8.0', DBParameterGroupFamily: 'aurora-mysql8.0' },
        { DBClusterParameterGroupName: 'docs-params', DBParameterGroupFamily: 'docdb5.0' }
      ]
    });
    rds.on(DescribeOptionGroupsCommand).resolves({
      OptionGroupsList: [{ OptionGroupName: 'mysql-audit' }, { OptionGroupName: 'default:mysql-8-0' }]
    });
    rds.on(DescribeEventSubscriptionsCommand).resolves({
      EventSubscriptionsList: [{ CustSubscriptionId: 'alerts', Status: 'active' }, { CustSubscriptionId: 'old', Status: 'deleting' }]
    });
    rds.on(DescribeDBProxiesCommand).resolves({ DBProxies: [{ DBProxyName: 'proxy' }] });
    rds.on(DescribeDBProxyTargetsCommand).resolves({
      Targets: [
        { Type: 'TRACKED_CLUSTER', RdsResourceId: 'aurora' },
        { Type: 'RDS_INSTANCE', RdsResourceId: 'aurora-1', TrackedClusterId: 'aurora' },
        { Type: 'RDS_INSTANCE', RdsResourceId: 'standalone' }
      ]
    });
    rds.on(DescribeDBProxyEndpointsCommand).resolves({
      DBProxyEndpoints: [
        { DBProxyName: 'proxy', DBProxyEndpointName: 'default', IsDefault: true },
        { DBProxyName: 'proxy', DBProxyEndpointName: 'reader', IsDefault: false }
      ]
    });

    const service = createService(RDSService, 'rds', 'eu-west-1');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_db_event_subscription:alerts',
      'aws_db_option_group:mysql-audit',
      'aws_db_parameter_group:pg16',
      'aws_db_proxy:proxy',
      'aws_db_proxy_default_target_group:proxy',
      'aws_db_proxy_endpoint:proxy/reader',
      'aws_db_proxy_target:proxy/default/RDS_INSTANCE/standalone',
      'aws_db_proxy_target:proxy/default/TRACKED_CLUSTER/aurora',
      'aws_rds_cluster_parameter_group:aurora-params'
    ]);
    expect(rds.commandCalls(DescribeDBProxyTargetsCommand)[0].args[0].input).toEqual({ DBProxyName: 'proxy', TargetGroupName: 'default' });
  });

  it('imports global clusters only in the region of the writer member', async () => {
    rds.on(DescribeGlobalClustersCommand).resolves({
      GlobalClusters: [
        { GlobalClusterIdentifier: 'home', Engine: 'aurora-mysql', GlobalClusterMembers: [
          { DBClusterArn: 'arn:aws:rds:eu-west-1:123456789012:cluster:a', IsWriter: true },
          { DBClusterArn: 'arn:aws:rds:us-east-1:123456789012:cluster:b', IsWriter: false }
        ] },
        { GlobalClusterIdentifier: 'elsewhere', Engine: 'aurora-mysql', GlobalClusterMembers: [
          { DBClusterArn: 'arn:aws:rds:us-east-1:123456789012:cluster:c', IsWriter: true },
          { DBClusterArn: 'arn:aws:rds:eu-west-1:123456789012:cluster:d', IsWriter: false }
        ] },
        { GlobalClusterIdentifier: 'empty', Engine: 'aurora-mysql', GlobalClusterMembers: [] },
        { GlobalClusterIdentifier: 'docs-global', Engine: 'docdb', GlobalClusterMembers: [
          { DBClusterArn: 'arn:aws:rds:eu-west-1:123456789012:cluster:e', IsWriter: true }
        ] }
      ]
    });

    const service = createService(RDSService, 'rds', 'eu-west-1');
    await service.initResources();

    expect(importIds(service)).toEqual(['aws_rds_global_cluster:home']);
  });

  it('claims every subnet group when clusters cannot be listed', async () => {
    rds.on(DescribeDBClustersCommand).rejects(Object.assign(new Error('denied'), { name: 'AccessDenied' }));
    rds.on(DescribeDBSubnetGroupsCommand).resolves({ DBSubnetGroups: [{ DBSubnetGroupName: 'any' }] });

    const service = createService(RDSService, 'rds', 'eu-west-1');
    await service.initResources();

    expect(importIds(service)).toEqual(['aws_db_subnet_group:any']);
    expect(service.getWarnings()[0]).toContain('AccessDenied');
  });
});

describe('subnetGroupOwners', () => {
  it('assigns exclusive DocumentDB/Neptune groups to those services and mixed groups to rds', () => {
    const owners = subnetGroupOwners([
      { subnetGroup: 'a', engine: 'docdb' },
      { subnetGroup: 'b', engine: 'neptune' },
      { subnetGroup: 'c', engine: 'docdb' },
      { subnetGroup: 'c', engine: 'postgres' }
    ]);
    expect(Object.fromEntries(owners)).toEqual({ a: 'docdb', b: 'neptune', c: 'rds' });
  });
});
