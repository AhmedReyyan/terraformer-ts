import { mockClient } from 'aws-sdk-client-mock';
import { ElasticLoadBalancingClient, DescribeLoadBalancersCommand } from '@aws-sdk/client-elastic-load-balancing';
import { ELBService } from '../elb';
import { createService, importIds } from './helpers';

const elb = mockClient(ElasticLoadBalancingClient);

beforeEach(() => elb.reset());

describe('ELBService', () => {
  it('imports classic load balancers by name across pages', async () => {
    elb.on(DescribeLoadBalancersCommand)
      .resolvesOnce({ LoadBalancerDescriptions: [{ LoadBalancerName: 'web' }], NextMarker: 'm1' })
      .resolvesOnce({ LoadBalancerDescriptions: [{ LoadBalancerName: 'api', VPCId: 'vpc-1' }] });

    const service = createService(ELBService, 'elb', 'eu-west-1');
    await service.initResources();

    expect(importIds(service)).toEqual(['aws_elb:api', 'aws_elb:web']);
    expect(elb.commandCalls(DescribeLoadBalancersCommand)[1].args[0].input).toMatchObject({ Marker: 'm1' });
    expect(service.getWarnings()).toEqual([]);
  });

  it('records a warning when the API is not available', async () => {
    elb.on(DescribeLoadBalancersCommand).rejects(Object.assign(new Error('denied'), { name: 'AccessDenied' }));

    const service = createService(ELBService, 'elb', 'eu-west-1');
    await service.initResources();

    expect(importIds(service)).toEqual([]);
    expect(service.getWarnings()[0]).toContain('AccessDenied');
  });
});
