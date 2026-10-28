import { mockClient } from 'aws-sdk-client-mock';
import {
  DatabaseMigrationServiceClient,
  DescribeReplicationInstancesCommand,
  DescribeEndpointsCommand,
  DescribeReplicationTasksCommand,
  DescribeReplicationSubnetGroupsCommand
} from '@aws-sdk/client-database-migration-service';
import { DMSService } from '../dms';
import { createService, importIds } from './helpers';

const dms = mockClient(DatabaseMigrationServiceClient);

beforeEach(() => dms.reset());

describe('DMSService', () => {
  it('imports instances, endpoints, tasks and subnet groups by identifier', async () => {
    dms.on(DescribeReplicationInstancesCommand).resolvesOnce({
      ReplicationInstances: [{ ReplicationInstanceIdentifier: 'ri-1', ReplicationInstanceStatus: 'available' }], Marker: 'm2'
    }).resolvesOnce({
      ReplicationInstances: [{ ReplicationInstanceIdentifier: 'ri-old', ReplicationInstanceStatus: 'deleting' }]
    });
    dms.on(DescribeEndpointsCommand).resolves({
      Endpoints: [
        { EndpointIdentifier: 'src', EngineName: 'postgres', Status: 'active' },
        { EndpointIdentifier: 'lake', EngineName: 's3', Status: 'active' },
        { EndpointIdentifier: 'gone', EngineName: 'mysql', Status: 'deleting' }
      ]
    });
    dms.on(DescribeReplicationTasksCommand).resolves({
      ReplicationTasks: [{ ReplicationTaskIdentifier: 'task-1', Status: 'ready' }, { ReplicationTaskIdentifier: 'task-2', Status: 'deleting' }]
    });
    dms.on(DescribeReplicationSubnetGroupsCommand).resolves({
      ReplicationSubnetGroups: [
        { ReplicationSubnetGroupIdentifier: 'default' },
        { ReplicationSubnetGroupIdentifier: 'default-vpc-0abc' },
        { ReplicationSubnetGroupIdentifier: 'private' }
      ]
    });

    const service = createService(DMSService, 'dms');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_dms_endpoint:src',
      'aws_dms_replication_instance:ri-1',
      'aws_dms_replication_subnet_group:private',
      'aws_dms_replication_task:task-1',
      'aws_dms_s3_endpoint:lake'
    ]);
    expect(dms.commandCalls(DescribeReplicationInstancesCommand)[1].args[0].input).toMatchObject({ Marker: 'm2' });
    expect(dms.commandCalls(DescribeReplicationTasksCommand)[0].args[0].input).toMatchObject({ WithoutSettings: true });
    expect(service.getWarnings()).toEqual([]);
  });
});
