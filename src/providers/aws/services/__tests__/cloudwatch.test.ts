import { mockClient } from 'aws-sdk-client-mock';
import { CloudWatchClient, DescribeAlarmsCommand, ListDashboardsCommand } from '@aws-sdk/client-cloudwatch';
import { CloudWatchService } from '../cloudwatch';
import { createService, importIds } from './helpers';

const cloudwatch = mockClient(CloudWatchClient);

beforeEach(() => cloudwatch.reset());

describe('CloudWatchService', () => {
  it('imports metric and composite alarms across pages and dashboards, skipping target tracking alarms', async () => {
    cloudwatch.on(DescribeAlarmsCommand)
      .resolvesOnce({
        MetricAlarms: [{ AlarmName: 'cpu-high' }, { AlarmName: 'TargetTracking-table/orders-AlarmHigh-abc' }],
        NextToken: 'page2'
      })
      .resolvesOnce({ CompositeAlarms: [{ AlarmName: 'service-down' }] });
    cloudwatch.on(ListDashboardsCommand).resolves({ DashboardEntries: [{ DashboardName: 'main' }] });

    const service = createService(CloudWatchService, 'cloudwatch');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_cloudwatch_composite_alarm:service-down',
      'aws_cloudwatch_dashboard:main',
      'aws_cloudwatch_metric_alarm:cpu-high'
    ]);
    const calls = cloudwatch.commandCalls(DescribeAlarmsCommand);
    expect(calls[0].args[0].input).toMatchObject({ AlarmTypes: ['MetricAlarm', 'CompositeAlarm'] });
    expect(calls[1].args[0].input).toMatchObject({ NextToken: 'page2' });
    expect(service.getWarnings()).toEqual([]);
  });
});
