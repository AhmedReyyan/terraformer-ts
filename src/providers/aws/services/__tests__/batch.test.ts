import { mockClient } from 'aws-sdk-client-mock';
import {
  BatchClient,
  DescribeComputeEnvironmentsCommand,
  DescribeJobQueuesCommand,
  DescribeJobDefinitionsCommand,
  ListSchedulingPoliciesCommand
} from '@aws-sdk/client-batch';
import { BatchService } from '../batch';
import { createService, importIds } from './helpers';

const batch = mockClient(BatchClient);
const arn = (kind: string, name: string) => `arn:aws:batch:us-east-1:123456789012:${kind}/${name}`;

beforeEach(() => batch.reset());

describe('BatchService', () => {
  it('imports compute environments, queues, latest job definitions and scheduling policies', async () => {
    batch.on(DescribeComputeEnvironmentsCommand)
      .resolvesOnce({
        computeEnvironments: [{ computeEnvironmentName: 'spot', computeEnvironmentArn: arn('compute-environment', 'spot'), status: 'VALID' }],
        nextToken: 'n1'
      })
      .resolvesOnce({
        computeEnvironments: [{ computeEnvironmentName: 'gone', computeEnvironmentArn: arn('compute-environment', 'gone'), status: 'DELETING' }]
      });
    batch.on(DescribeJobQueuesCommand).resolves({
      jobQueues: [
        { jobQueueName: 'main', jobQueueArn: arn('job-queue', 'main'), status: 'VALID' } as any,
        { jobQueueName: 'old', jobQueueArn: arn('job-queue', 'old'), status: 'DELETED' } as any
      ]
    });
    batch.on(DescribeJobDefinitionsCommand)
      .resolvesOnce({
        jobDefinitions: [
          { jobDefinitionName: 'etl', jobDefinitionArn: arn('job-definition', 'etl:1'), revision: 1, status: 'ACTIVE', type: 'container' }
        ],
        nextToken: 'j1'
      })
      .resolvesOnce({
        jobDefinitions: [
          { jobDefinitionName: 'etl', jobDefinitionArn: arn('job-definition', 'etl:3'), revision: 3, status: 'ACTIVE', type: 'container' },
          { jobDefinitionName: 'etl', jobDefinitionArn: arn('job-definition', 'etl:2'), revision: 2, status: 'ACTIVE', type: 'container' }
        ]
      });
    batch.on(ListSchedulingPoliciesCommand).resolves({ schedulingPolicies: [{ arn: arn('scheduling-policy', 'fair') }] });

    const service = createService(BatchService, 'batch');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_batch_compute_environment:spot',
      `aws_batch_job_definition:${arn('job-definition', 'etl:3')}`,
      `aws_batch_job_queue:${arn('job-queue', 'main')}`,
      `aws_batch_scheduling_policy:${arn('scheduling-policy', 'fair')}`
    ]);
    expect(batch.commandCalls(DescribeJobDefinitionsCommand)[0].args[0].input).toMatchObject({ status: 'ACTIVE' });
    expect(service.getWarnings()).toEqual([]);
  });
});
