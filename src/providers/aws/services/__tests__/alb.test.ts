import { mockClient } from 'aws-sdk-client-mock';
import {
  ElasticLoadBalancingV2Client,
  DescribeLoadBalancersCommand,
  DescribeListenersCommand,
  DescribeRulesCommand,
  DescribeTargetGroupsCommand,
  DescribeListenerCertificatesCommand
} from '@aws-sdk/client-elastic-load-balancing-v2';
import { ALBService } from '../alb';
import { createService, importIds } from './helpers';

const elb = mockClient(ElasticLoadBalancingV2Client);
const PREFIX = 'arn:aws:elasticloadbalancing:eu-west-1:111111111111';
const LB = `${PREFIX}:loadbalancer/app/web/1`;
const NLB = `${PREFIX}:loadbalancer/net/tcp/2`;
const HTTPS = `${PREFIX}:listener/app/web/1/a`;
const HTTP = `${PREFIX}:listener/app/web/1/b`;
const CERT = 'arn:aws:acm:eu-west-1:111111111111:certificate/extra';

beforeEach(() => {
  elb.reset();
  elb.on(DescribeLoadBalancersCommand).resolves({});
  elb.on(DescribeListenersCommand).resolves({});
  elb.on(DescribeRulesCommand).resolves({});
  elb.on(DescribeTargetGroupsCommand).resolves({});
  elb.on(DescribeListenerCertificatesCommand).resolves({});
});

describe('ALBService', () => {
  it('imports load balancers, listeners, non-default rules, extra certificates and target groups by ARN', async () => {
    elb.on(DescribeLoadBalancersCommand)
      .resolvesOnce({ LoadBalancers: [{ LoadBalancerArn: LB, LoadBalancerName: 'web', Type: 'application' }], NextMarker: 'm' })
      .resolvesOnce({
        LoadBalancers: [
          { LoadBalancerArn: NLB, LoadBalancerName: 'tcp', Type: 'network' },
          { LoadBalancerArn: `${PREFIX}:loadbalancer/app/broken/3`, LoadBalancerName: 'broken', State: { Code: 'failed' } }
        ]
      });
    elb.on(DescribeListenersCommand, { LoadBalancerArn: LB }).resolves({
      Listeners: [{ ListenerArn: HTTPS, Port: 443, Protocol: 'HTTPS' }, { ListenerArn: HTTP, Port: 80, Protocol: 'HTTP' }]
    });
    elb.on(DescribeRulesCommand, { ListenerArn: HTTPS })
      .resolvesOnce({ Rules: [{ RuleArn: `${PREFIX}:listener-rule/app/web/1/a/default`, IsDefault: true, Priority: 'default' }], NextMarker: 'r' })
      .resolvesOnce({ Rules: [{ RuleArn: `${PREFIX}:listener-rule/app/web/1/a/r1`, IsDefault: false, Priority: '10' }] });
    elb.on(DescribeListenerCertificatesCommand, { ListenerArn: HTTPS }).resolves({
      Certificates: [
        { CertificateArn: 'arn:aws:acm:eu-west-1:111111111111:certificate/default', IsDefault: true },
        { CertificateArn: CERT, IsDefault: false }
      ]
    });
    elb.on(DescribeTargetGroupsCommand).resolves({
      TargetGroups: [{ TargetGroupArn: `${PREFIX}:targetgroup/web/9`, TargetGroupName: 'web' }]
    });

    const service = createService(ALBService, 'alb', 'eu-west-1');
    await service.initResources();

    expect(importIds(service)).toEqual([
      `aws_lb:${LB}`,
      `aws_lb:${NLB}`,
      `aws_lb_listener:${HTTPS}`,
      `aws_lb_listener:${HTTP}`,
      `aws_lb_listener_certificate:${HTTPS}_${CERT}`,
      `aws_lb_listener_rule:${PREFIX}:listener-rule/app/web/1/a/r1`,
      `aws_lb_target_group:${PREFIX}:targetgroup/web/9`
    ].sort());
    // Certificates are only listed for HTTPS/TLS listeners.
    expect(elb.commandCalls(DescribeListenerCertificatesCommand).map(c => c.args[0].input)).toEqual([{ ListenerArn: HTTPS }]);
    expect(elb.commandCalls(DescribeLoadBalancersCommand)[1].args[0].input).toMatchObject({ Marker: 'm' });
    expect(elb.commandCalls(DescribeRulesCommand, { ListenerArn: HTTPS })[1].args[0].input).toMatchObject({ Marker: 'r' });
    expect(service.getWarnings()).toEqual([]);
  });

  it('keeps the load balancer and warns when its listeners cannot be read', async () => {
    elb.on(DescribeLoadBalancersCommand).resolves({ LoadBalancers: [{ LoadBalancerArn: LB, LoadBalancerName: 'web' }] });
    elb.on(DescribeListenersCommand).rejects(Object.assign(new Error('denied'), { name: 'AccessDenied' }));

    const service = createService(ALBService, 'alb', 'eu-west-1');
    await service.initResources();

    expect(importIds(service)).toEqual([`aws_lb:${LB}`]);
    expect(service.getWarnings()[0]).toContain('AccessDenied');
  });
});
