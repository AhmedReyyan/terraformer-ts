import {
  AutoScalingClient,
  paginateDescribeAutoScalingGroups,
  paginateDescribeLaunchConfigurations,
  paginateDescribePolicies,
  paginateDescribeScheduledActions,
  DescribeLifecycleHooksCommand
} from '@aws-sdk/client-auto-scaling';
import { mapLimit } from '../../../core/provider';
import { AwsService, tagMap } from '../aws-service';

export class AutoScalingService extends AwsService {
  async initResources(): Promise<void> {
    const autoscaling = this.client(AutoScalingClient);
    const groups: string[] = [];
    // Groups that are not imported; their policies, schedules and hooks are skipped too.
    const skippedGroups = new Set<string>();

    await this.collect('Auto Scaling groups', async () => {
      for await (const page of paginateDescribeAutoScalingGroups({ client: autoscaling }, {})) {
        for (const group of page.AutoScalingGroups || []) {
          const name = group.AutoScalingGroupName;
          if (!name) {
            continue;
          }
          const tags = tagMap(group.Tags);
          // Groups of EKS managed node groups are created and reconciled by EKS (manage aws_eks_node_group
          // instead); groups being deleted are gone. Tags, load balancer and target group attachments
          // are inline in aws_autoscaling_group, so no aws_autoscaling_group_tag / _attachment.
          if (tags['eks:nodegroup-name'] !== undefined || group.Status === 'Delete in progress') {
            skippedGroups.add(name);
            continue;
          }
          this.add('aws_autoscaling_group', name, name, { name, arn: group.AutoScalingGroupARN, tags });
          groups.push(name);
        }
      }
    });

    await this.collect('launch configurations', async () => {
      for await (const page of paginateDescribeLaunchConfigurations({ client: autoscaling }, {})) {
        for (const config of page.LaunchConfigurations || []) {
          if (config.LaunchConfigurationName) {
            this.add('aws_launch_configuration', config.LaunchConfigurationName, config.LaunchConfigurationName, {
              name: config.LaunchConfigurationName,
              arn: config.LaunchConfigurationARN
            });
          }
        }
      }
    });

    await this.collect('scaling policies', async () => {
      for await (const page of paginateDescribePolicies({ client: autoscaling }, {})) {
        for (const policy of page.ScalingPolicies || []) {
          const group = policy.AutoScalingGroupName;
          if (!group || !policy.PolicyName || skippedGroups.has(group)) {
            continue;
          }
          this.add('aws_autoscaling_policy', `${group}/${policy.PolicyName}`, `${group}_${policy.PolicyName}`, {
            name: policy.PolicyName,
            autoscaling_group_name: group,
            arn: policy.PolicyARN
          });
        }
      }
    });

    await this.collect('scheduled actions', async () => {
      for await (const page of paginateDescribeScheduledActions({ client: autoscaling }, {})) {
        for (const action of page.ScheduledUpdateGroupActions || []) {
          const group = action.AutoScalingGroupName;
          if (!group || !action.ScheduledActionName || skippedGroups.has(group)) {
            continue;
          }
          this.add('aws_autoscaling_schedule', `${group}/${action.ScheduledActionName}`, `${group}_${action.ScheduledActionName}`, {
            name: action.ScheduledActionName,
            autoscaling_group_name: group,
            arn: action.ScheduledActionARN
          });
        }
      }
    });

    // DescribeLifecycleHooks is per group and not paginated.
    await mapLimit(groups, 5, group => this.collect(`lifecycle hooks of ${group}`, async () => {
      const response = await autoscaling.send(new DescribeLifecycleHooksCommand({ AutoScalingGroupName: group }));
      for (const hook of response.LifecycleHooks || []) {
        if (hook.LifecycleHookName) {
          this.add('aws_autoscaling_lifecycle_hook', `${group}/${hook.LifecycleHookName}`, `${group}_${hook.LifecycleHookName}`, {
            name: hook.LifecycleHookName,
            autoscaling_group_name: group
          });
        }
      }
    }));
  }
}
