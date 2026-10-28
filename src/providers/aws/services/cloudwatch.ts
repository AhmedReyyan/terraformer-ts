import { CloudWatchClient, paginateDescribeAlarms, paginateListDashboards } from '@aws-sdk/client-cloudwatch';
import { AwsService } from '../aws-service';

/** Alarms created by Application Auto Scaling target tracking policies are owned by the scaling policy. */
const isTargetTrackingAlarm = (name: string): boolean => name.startsWith('TargetTracking-');

export class CloudWatchService extends AwsService {
  async initResources(): Promise<void> {
    const cloudwatch = this.client(CloudWatchClient);

    await this.collect('CloudWatch alarms', async () => {
      for await (const page of paginateDescribeAlarms({ client: cloudwatch }, { AlarmTypes: ['MetricAlarm', 'CompositeAlarm'] })) {
        for (const alarm of page.MetricAlarms || []) {
          const name = alarm.AlarmName;
          if (name && !isTargetTrackingAlarm(name)) {
            this.add('aws_cloudwatch_metric_alarm', name, name, { name, arn: alarm.AlarmArn });
          }
        }
        for (const alarm of page.CompositeAlarms || []) {
          const name = alarm.AlarmName;
          if (name && !isTargetTrackingAlarm(name)) {
            this.add('aws_cloudwatch_composite_alarm', name, name, { name, arn: alarm.AlarmArn });
          }
        }
      }
    });

    await this.collect('CloudWatch dashboards', async () => {
      for await (const page of paginateListDashboards({ client: cloudwatch }, {})) {
        for (const dashboard of page.DashboardEntries || []) {
          const name = dashboard.DashboardName;
          if (name) {
            this.add('aws_cloudwatch_dashboard', name, name, { name, arn: dashboard.DashboardArn });
          }
        }
      }
    });
  }
}
