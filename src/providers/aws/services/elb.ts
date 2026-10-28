import { ElasticLoadBalancingClient, paginateDescribeLoadBalancers } from '@aws-sdk/client-elastic-load-balancing';
import { AwsService } from '../aws-service';

export class ELBService extends AwsService {
  async initResources(): Promise<void> {
    const elb = this.client(ElasticLoadBalancingClient);

    await this.collect('classic load balancers', async () => {
      for await (const page of paginateDescribeLoadBalancers({ client: elb }, {})) {
        for (const lb of page.LoadBalancerDescriptions || []) {
          // Listeners, health check and registered instances are inline in aws_elb, so neither
          // aws_elb_attachment nor listener resources are imported.
          if (lb.LoadBalancerName) {
            this.add('aws_elb', lb.LoadBalancerName, lb.LoadBalancerName, {
              name: lb.LoadBalancerName,
              dns_name: lb.DNSName,
              vpc_id: lb.VPCId
            });
          }
        }
      }
    });
  }
}
