import { mockClient } from 'aws-sdk-client-mock';
import {
  RedshiftClient,
  DescribeClustersCommand,
  DescribeClusterSubnetGroupsCommand,
  DescribeClusterParameterGroupsCommand
} from '@aws-sdk/client-redshift';
import { RedshiftService } from '../redshift';
import { createService, importIds } from './helpers';

const redshift = mockClient(RedshiftClient);

beforeEach(() => {
  redshift.reset();
  redshift.onAnyCommand().resolves({});
});

describe('RedshiftService', () => {
  it('imports clusters, subnet groups and parameter groups, skipping defaults', async () => {
    redshift.on(DescribeClustersCommand)
      .resolvesOnce({ Clusters: [{ ClusterIdentifier: 'warehouse', Tags: [{ Key: 'team', Value: 'bi' }] }], Marker: 'm' })
      .resolves({ Clusters: [{ ClusterIdentifier: 'old', ClusterStatus: 'deleting' }, { ClusterIdentifier: 'analytics' }] });
    redshift.on(DescribeClusterSubnetGroupsCommand).resolves({
      ClusterSubnetGroups: [{ ClusterSubnetGroupName: 'dw-net' }, { ClusterSubnetGroupName: 'default' }]
    });
    redshift.on(DescribeClusterParameterGroupsCommand).resolves({
      ParameterGroups: [{ ParameterGroupName: 'dw-params' }, { ParameterGroupName: 'default.redshift-1.0' }]
    });

    const service = createService(RedshiftService, 'redshift', 'eu-west-1');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_redshift_cluster:analytics',
      'aws_redshift_cluster:warehouse',
      'aws_redshift_parameter_group:dw-params',
      'aws_redshift_subnet_group:dw-net'
    ]);
    expect(redshift.commandCalls(DescribeClustersCommand)[1].args[0].input).toMatchObject({ Marker: 'm' });
    expect(service.getResources().find(r => r.id === 'warehouse')?.attributes.tags).toEqual({ team: 'bi' });
    expect(service.getWarnings()).toEqual([]);
  });
});
