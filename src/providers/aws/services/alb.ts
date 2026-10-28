import {
  ElasticLoadBalancingV2Client,
  paginateDescribeLoadBalancers,
  paginateDescribeListeners,
  paginateDescribeRules,
  paginateDescribeTargetGroups,
  paginateDescribeListenerCertificates
} from '@aws-sdk/client-elastic-load-balancing-v2';
import { mapLimit } from '../../../core/provider';
import { AwsService, arnResourceName } from '../aws-service';

export class ALBService extends AwsService {
  async initResources(): Promise<void> {
    const elb = this.client(ElasticLoadBalancingV2Client);
    const loadBalancers: Array<{ arn: string; name: string }> = [];

    await this.collect('load balancers', async () => {
      for await (const page of paginateDescribeLoadBalancers({ client: elb }, {})) {
        for (const lb of page.LoadBalancers || []) {
          if (!lb.LoadBalancerArn || lb.State?.Code === 'failed') {
            continue;
          }
          const name = lb.LoadBalancerName || arnResourceName(lb.LoadBalancerArn);
          this.add('aws_lb', lb.LoadBalancerArn, name, {
            name,
            arn: lb.LoadBalancerArn,
            type: lb.Type,
            dns_name: lb.DNSName,
            vpc_id: lb.VpcId
          });
          loadBalancers.push({ arn: lb.LoadBalancerArn, name });
        }
      }
    });

    const listeners: Array<{ arn: string; name: string; secure: boolean }> = [];
    await mapLimit(loadBalancers, 5, lb => this.collect(`listeners of ${lb.name}`, async () => {
      for await (const page of paginateDescribeListeners({ client: elb }, { LoadBalancerArn: lb.arn })) {
        for (const listener of page.Listeners || []) {
          if (!listener.ListenerArn) {
            continue;
          }
          const name = `${lb.name}_${listener.Protocol || 'listener'}_${listener.Port ?? ''}`;
          this.add('aws_lb_listener', listener.ListenerArn, name, {
            arn: listener.ListenerArn,
            load_balancer_arn: lb.arn,
            port: listener.Port,
            protocol: listener.Protocol
          });
          listeners.push({ arn: listener.ListenerArn, name, secure: listener.Protocol === 'HTTPS' || listener.Protocol === 'TLS' });
        }
      }
    }));

    await mapLimit(listeners, 5, listener => this.collect(`rules of ${listener.name}`, async () => {
      for await (const page of paginateDescribeRules({ client: elb }, { ListenerArn: listener.arn })) {
        for (const rule of page.Rules || []) {
          // The default rule is the listener's default_action, part of aws_lb_listener.
          if (!rule.RuleArn || rule.IsDefault) {
            continue;
          }
          this.add('aws_lb_listener_rule', rule.RuleArn, `${listener.name}_${rule.Priority || arnResourceName(rule.RuleArn)}`, {
            arn: rule.RuleArn,
            listener_arn: listener.arn,
            priority: rule.Priority
          });
        }
      }
    }));

    // aws_lb_listener.certificate_arn holds only the default certificate; additional SNI certificates
    // are separate aws_lb_listener_certificate resources.
    await mapLimit(listeners.filter(listener => listener.secure), 5, listener =>
      this.collect(`certificates of ${listener.name}`, async () => {
        for await (const page of paginateDescribeListenerCertificates({ client: elb }, { ListenerArn: listener.arn })) {
          for (const certificate of page.Certificates || []) {
            if (!certificate.CertificateArn || certificate.IsDefault) {
              continue;
            }
            this.add('aws_lb_listener_certificate', `${listener.arn}_${certificate.CertificateArn}`,
              `${listener.name}_${arnResourceName(certificate.CertificateArn)}`, {
                listener_arn: listener.arn,
                certificate_arn: certificate.CertificateArn
              });
          }
        }
      }));

    await this.collect('target groups', async () => {
      for await (const page of paginateDescribeTargetGroups({ client: elb }, {})) {
        for (const group of page.TargetGroups || []) {
          // Registered targets (aws_lb_target_group_attachment) are not imported: they are usually
          // registered dynamically by Auto Scaling, ECS or EKS.
          if (!group.TargetGroupArn) {
            continue;
          }
          const name = group.TargetGroupName || arnResourceName(group.TargetGroupArn);
          this.add('aws_lb_target_group', group.TargetGroupArn, name, {
            name,
            arn: group.TargetGroupArn,
            vpc_id: group.VpcId,
            target_type: group.TargetType
          });
        }
      }
    });
  }
}
