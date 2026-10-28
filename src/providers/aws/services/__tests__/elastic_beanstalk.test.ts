import { mockClient } from 'aws-sdk-client-mock';
import {
  ElasticBeanstalkClient,
  DescribeApplicationsCommand,
  DescribeEnvironmentsCommand
} from '@aws-sdk/client-elastic-beanstalk';
import { ElasticBeanstalkService } from '../elastic_beanstalk';
import { createService, importIds } from './helpers';

const eb = mockClient(ElasticBeanstalkClient);

beforeEach(() => eb.reset());

describe('ElasticBeanstalkService', () => {
  it('imports applications and live environments by ID', async () => {
    eb.on(DescribeApplicationsCommand).resolves({ Applications: [{ ApplicationName: 'shop' }] });
    eb.on(DescribeEnvironmentsCommand)
      .resolvesOnce({ Environments: [{ EnvironmentId: 'e-abc123', EnvironmentName: 'shop-prod', Status: 'Ready' }], NextToken: 'n1' })
      .resolvesOnce({
        Environments: [
          { EnvironmentId: 'e-dead', EnvironmentName: 'shop-old', Status: 'Terminated' },
          { EnvironmentId: 'e-dying', EnvironmentName: 'shop-tmp', Status: 'Terminating' }
        ]
      });

    const service = createService(ElasticBeanstalkService, 'elastic_beanstalk');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_elastic_beanstalk_application:shop',
      'aws_elastic_beanstalk_environment:e-abc123'
    ]);
    expect(eb.commandCalls(DescribeEnvironmentsCommand)[1].args[0].input).toMatchObject({ NextToken: 'n1' });
    expect(service.getWarnings()).toEqual([]);
  });
});
