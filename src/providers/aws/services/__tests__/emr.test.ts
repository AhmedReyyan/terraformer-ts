import { mockClient } from 'aws-sdk-client-mock';
import {
  EMRClient,
  ListClustersCommand,
  ListSecurityConfigurationsCommand,
  ListStudiosCommand,
  ListInstanceGroupsCommand,
  GetManagedScalingPolicyCommand
} from '@aws-sdk/client-emr';
import { EMRService } from '../emr';
import { createService, importIds } from './helpers';

const emr = mockClient(EMRClient);

beforeEach(() => {
  emr.reset();
  emr.on(ListSecurityConfigurationsCommand).resolves({ SecurityConfigurations: [] });
  emr.on(ListStudiosCommand).resolves({ Studios: [] });
  emr.on(ListInstanceGroupsCommand).resolves({ InstanceGroups: [] });
  emr.on(GetManagedScalingPolicyCommand).resolves({});
});

describe('EMRService', () => {
  it('imports active clusters, task instance groups, scaling policies, security configurations and studios', async () => {
    emr.on(ListClustersCommand)
      .resolvesOnce({ Clusters: [{ Id: 'j-AAA', Name: 'analytics' }], Marker: 'm1' })
      .resolvesOnce({ Clusters: [{ Id: 'j-BBB', Name: 'fleet' }] });
    emr.on(GetManagedScalingPolicyCommand, { ClusterId: 'j-AAA' }).resolves({
      ManagedScalingPolicy: { ComputeLimits: { UnitType: 'Instances', MinimumCapacityUnits: 1, MaximumCapacityUnits: 5 } }
    });
    emr.on(ListInstanceGroupsCommand, { ClusterId: 'j-AAA' }).resolves({
      InstanceGroups: [
        { Id: 'ig-MASTER', InstanceGroupType: 'MASTER' },
        { Id: 'ig-TASK', Name: 'task', InstanceGroupType: 'TASK', Status: { State: 'RUNNING' } },
        { Id: 'ig-ENDED', InstanceGroupType: 'TASK', Status: { State: 'ENDED' } }
      ]
    });
    emr.on(ListInstanceGroupsCommand, { ClusterId: 'j-BBB' })
      .rejects(Object.assign(new Error('uses instance fleets'), { name: 'InvalidRequestException' }));
    emr.on(ListSecurityConfigurationsCommand).resolves({ SecurityConfigurations: [{ Name: 'kerberos' }] });
    emr.on(ListStudiosCommand).resolves({ Studios: [{ StudioId: 'es-123', Name: 'lab' }] });

    const service = createService(EMRService, 'emr');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_emr_cluster:j-AAA',
      'aws_emr_cluster:j-BBB',
      'aws_emr_instance_group:j-AAA/ig-TASK',
      'aws_emr_managed_scaling_policy:j-AAA',
      'aws_emr_security_configuration:kerberos',
      'aws_emr_studio:es-123'
    ]);
    expect(emr.commandCalls(ListClustersCommand)[0].args[0].input.ClusterStates)
      .toEqual(['STARTING', 'BOOTSTRAPPING', 'RUNNING', 'WAITING']);
    expect(service.getWarnings()).toEqual([]);
  });
});
