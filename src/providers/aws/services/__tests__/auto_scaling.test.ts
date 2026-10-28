import { mockClient } from 'aws-sdk-client-mock';
import {
  AutoScalingClient,
  AutoScalingGroup,
  LaunchConfiguration,
  DescribeAutoScalingGroupsCommand,
  DescribeLaunchConfigurationsCommand,
  DescribePoliciesCommand,
  DescribeScheduledActionsCommand,
  DescribeLifecycleHooksCommand
} from '@aws-sdk/client-auto-scaling';
import { AutoScalingService } from '../auto_scaling';
import { createService, importIds } from './helpers';

const autoscaling = mockClient(AutoScalingClient);

/** The SDK types mark several fields as required; tests only need the identifying ones. */
const group = (fields: Partial<AutoScalingGroup>) => fields as AutoScalingGroup;
const launchConfig = (name: string) => ({ LaunchConfigurationName: name }) as LaunchConfiguration;

beforeEach(() => {
  autoscaling.reset();
  autoscaling.on(DescribeAutoScalingGroupsCommand).resolves({ AutoScalingGroups: [] });
  autoscaling.on(DescribeLaunchConfigurationsCommand).resolves({ LaunchConfigurations: [] });
  autoscaling.on(DescribePoliciesCommand).resolves({});
  autoscaling.on(DescribeScheduledActionsCommand).resolves({});
  autoscaling.on(DescribeLifecycleHooksCommand).resolves({});
});

describe('AutoScalingService', () => {
  it('imports groups with their policies, schedules and hooks, skipping EKS node groups and deleting groups', async () => {
    autoscaling.on(DescribeAutoScalingGroupsCommand)
      .resolvesOnce({ AutoScalingGroups: [group({ AutoScalingGroupName: 'web', Tags: [{ Key: 'team', Value: 'a' }] })], NextToken: 'g2' })
      .resolvesOnce({
        AutoScalingGroups: [
          group({ AutoScalingGroupName: 'eks-ng', Tags: [{ Key: 'eks:nodegroup-name', Value: 'ng' }] }),
          group({ AutoScalingGroupName: 'dying', Status: 'Delete in progress' })
        ]
      });
    autoscaling.on(DescribeLaunchConfigurationsCommand).resolves({ LaunchConfigurations: [launchConfig('web-lc')] });
    autoscaling.on(DescribePoliciesCommand)
      .resolvesOnce({ ScalingPolicies: [{ AutoScalingGroupName: 'web', PolicyName: 'cpu' }], NextToken: 'p2' })
      .resolvesOnce({ ScalingPolicies: [{ AutoScalingGroupName: 'eks-ng', PolicyName: 'cpu' }] });
    autoscaling.on(DescribeScheduledActionsCommand).resolves({
      ScheduledUpdateGroupActions: [
        { AutoScalingGroupName: 'web', ScheduledActionName: 'nightly' },
        { AutoScalingGroupName: 'dying', ScheduledActionName: 'nightly' }
      ]
    });
    autoscaling.on(DescribeLifecycleHooksCommand, { AutoScalingGroupName: 'web' }).resolves({
      LifecycleHooks: [{ LifecycleHookName: 'drain', AutoScalingGroupName: 'web' }]
    });

    const service = createService(AutoScalingService, 'auto_scaling', 'eu-west-1');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_autoscaling_group:web',
      'aws_autoscaling_lifecycle_hook:web/drain',
      'aws_autoscaling_policy:web/cpu',
      'aws_autoscaling_schedule:web/nightly',
      'aws_launch_configuration:web-lc'
    ]);
    expect(autoscaling.commandCalls(DescribeAutoScalingGroupsCommand)[1].args[0].input).toMatchObject({ NextToken: 'g2' });
    expect(autoscaling.commandCalls(DescribePoliciesCommand)[1].args[0].input).toMatchObject({ NextToken: 'p2' });
    expect(autoscaling.commandCalls(DescribeLifecycleHooksCommand).map(c => c.args[0].input)).toEqual([{ AutoScalingGroupName: 'web' }]);
    expect(service.getResources().find(r => r.type === 'aws_autoscaling_group')?.attributes.tags).toEqual({ team: 'a' });
    expect(service.getWarnings()).toEqual([]);
  });

  it('records a warning and continues when a list call fails', async () => {
    autoscaling.on(DescribeAutoScalingGroupsCommand).rejects(Object.assign(new Error('denied'), { name: 'AccessDenied' }));
    autoscaling.on(DescribeLaunchConfigurationsCommand).resolves({ LaunchConfigurations: [launchConfig('lc')] });

    const service = createService(AutoScalingService, 'auto_scaling', 'eu-west-1');
    await service.initResources();

    expect(importIds(service)).toEqual(['aws_launch_configuration:lc']);
    expect(service.getWarnings()[0]).toContain('AccessDenied');
  });
});
