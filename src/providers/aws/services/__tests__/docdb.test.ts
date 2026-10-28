import { mockClient } from 'aws-sdk-client-mock';
import {
  DocDBClient,
  DescribeDBClustersCommand,
  DescribeDBInstancesCommand,
  DescribeDBClusterParameterGroupsCommand,
  DescribeDBSubnetGroupsCommand,
  DescribeGlobalClustersCommand
} from '@aws-sdk/client-docdb';
import { DocDBService } from '../docdb';
import { createService, importIds } from './helpers';

const docdb = mockClient(DocDBClient);

beforeEach(() => {
  docdb.reset();
  docdb.onAnyCommand().resolves({});
});

describe('DocDBService', () => {
  it('imports only DocumentDB objects and subnet groups used exclusively by DocumentDB', async () => {
    docdb.on(DescribeDBClustersCommand)
      .resolvesOnce({ DBClusters: [{ DBClusterIdentifier: 'docs', Engine: 'docdb', DBSubnetGroup: 'docs-net' }], Marker: 'm' })
      .resolves({
        DBClusters: [
          { DBClusterIdentifier: 'aurora', Engine: 'aurora-mysql', DBSubnetGroup: 'shared' },
          { DBClusterIdentifier: 'docs2', Engine: 'docdb', DBSubnetGroup: 'shared' },
          { DBClusterIdentifier: 'gone', Engine: 'docdb', Status: 'deleting' }
        ]
      });
    docdb.on(DescribeDBInstancesCommand).resolves({
      DBInstances: [
        { DBInstanceIdentifier: 'docs-1', Engine: 'docdb', DBClusterIdentifier: 'docs', DBSubnetGroup: { DBSubnetGroupName: 'docs-net' } },
        { DBInstanceIdentifier: 'pg', Engine: 'postgres' },
        { DBInstanceIdentifier: 'docs-dying', Engine: 'docdb', DBInstanceStatus: 'deleting' }
      ]
    });
    docdb.on(DescribeDBClusterParameterGroupsCommand).resolves({
      DBClusterParameterGroups: [
        { DBClusterParameterGroupName: 'docs-params', DBParameterGroupFamily: 'docdb5.0' },
        { DBClusterParameterGroupName: 'default.docdb5.0', DBParameterGroupFamily: 'docdb5.0' },
        { DBClusterParameterGroupName: 'aurora-params', DBParameterGroupFamily: 'aurora-mysql8.0' }
      ]
    });
    docdb.on(DescribeDBSubnetGroupsCommand).resolves({
      DBSubnetGroups: [{ DBSubnetGroupName: 'docs-net' }, { DBSubnetGroupName: 'shared' }, { DBSubnetGroupName: 'default' }]
    });
    docdb.on(DescribeGlobalClustersCommand).resolves({
      GlobalClusters: [
        { GlobalClusterIdentifier: 'docs-global', Engine: 'docdb', GlobalClusterMembers: [
          { DBClusterArn: 'arn:aws:rds:eu-west-1:123456789012:cluster:docs', IsWriter: true }
        ] },
        { GlobalClusterIdentifier: 'docs-secondary', Engine: 'docdb', GlobalClusterMembers: [
          { DBClusterArn: 'arn:aws:rds:us-east-1:123456789012:cluster:x', IsWriter: true }
        ] },
        { GlobalClusterIdentifier: 'aurora-global', Engine: 'aurora-mysql', GlobalClusterMembers: [
          { DBClusterArn: 'arn:aws:rds:eu-west-1:123456789012:cluster:aurora', IsWriter: true }
        ] }
      ]
    });

    const service = createService(DocDBService, 'docdb', 'eu-west-1');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_docdb_cluster:docs',
      'aws_docdb_cluster:docs2',
      'aws_docdb_cluster_instance:docs-1',
      'aws_docdb_cluster_parameter_group:docs-params',
      'aws_docdb_global_cluster:docs-global',
      'aws_docdb_subnet_group:docs-net'
    ]);
    expect(docdb.commandCalls(DescribeDBClustersCommand)[1].args[0].input).toMatchObject({ Marker: 'm' });
    expect(service.getWarnings()).toEqual([]);
  });

  it('does not import subnet groups when ownership cannot be determined', async () => {
    docdb.on(DescribeDBInstancesCommand).rejects(Object.assign(new Error('denied'), { name: 'AccessDenied' }));
    docdb.on(DescribeDBClustersCommand).resolves({ DBClusters: [{ DBClusterIdentifier: 'docs', Engine: 'docdb', DBSubnetGroup: 'docs-net' }] });
    docdb.on(DescribeDBSubnetGroupsCommand).resolves({ DBSubnetGroups: [{ DBSubnetGroupName: 'docs-net' }] });

    const service = createService(DocDBService, 'docdb', 'eu-west-1');
    await service.initResources();

    expect(importIds(service)).toEqual(['aws_docdb_cluster:docs']);
    expect(service.getWarnings()[0]).toContain('AccessDenied');
  });
});
