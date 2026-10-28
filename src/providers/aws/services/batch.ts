import {
  BatchClient,
  paginateDescribeComputeEnvironments,
  paginateDescribeJobQueues,
  paginateDescribeJobDefinitions,
  paginateListSchedulingPolicies,
  JobDefinition
} from '@aws-sdk/client-batch';
import { AwsService, arnResourceName } from '../aws-service';

/** Objects in these states are deleted or about to be. */
const DELETED_STATES = new Set(['DELETING', 'DELETED']);

export class BatchService extends AwsService {
  async initResources(): Promise<void> {
    const batch = this.client(BatchClient);

    await this.collect('Batch compute environments', async () => {
      for await (const page of paginateDescribeComputeEnvironments({ client: batch }, {})) {
        for (const env of page.computeEnvironments || []) {
          if (!env.computeEnvironmentName || DELETED_STATES.has(env.status || '')) {
            continue;
          }
          // Imported by name (the documented `id` form), not by ARN.
          this.add('aws_batch_compute_environment', env.computeEnvironmentName, env.computeEnvironmentName, {
            name: env.computeEnvironmentName,
            arn: env.computeEnvironmentArn,
            tags: env.tags || {}
          });
        }
      }
    });

    await this.collect('Batch job queues', async () => {
      for await (const page of paginateDescribeJobQueues({ client: batch }, {})) {
        for (const queue of page.jobQueues || []) {
          if (!queue.jobQueueArn || DELETED_STATES.has(queue.status || '')) {
            continue;
          }
          this.add('aws_batch_job_queue', queue.jobQueueArn, queue.jobQueueName || arnResourceName(queue.jobQueueArn), {
            name: queue.jobQueueName,
            arn: queue.jobQueueArn,
            tags: queue.tags || {}
          });
        }
      }
    });

    await this.collect('Batch job definitions', async () => {
      // Every registration creates a new revision; only the latest ACTIVE revision of each name is managed.
      const latest = new Map<string, JobDefinition>();
      for await (const page of paginateDescribeJobDefinitions({ client: batch }, { status: 'ACTIVE' })) {
        for (const definition of page.jobDefinitions || []) {
          const name = definition.jobDefinitionName;
          if (!name || !definition.jobDefinitionArn || definition.status !== 'ACTIVE') {
            continue;
          }
          const current = latest.get(name);
          if (!current || (definition.revision ?? 0) > (current.revision ?? 0)) {
            latest.set(name, definition);
          }
        }
      }
      for (const [name, definition] of latest) {
        // The ARN includes the revision (job-definition/<name>:<revision>).
        this.add('aws_batch_job_definition', definition.jobDefinitionArn!, name, {
          name,
          revision: definition.revision,
          arn: definition.jobDefinitionArn,
          tags: definition.tags || {}
        });
      }
    });

    await this.collect('Batch scheduling policies', async () => {
      for await (const page of paginateListSchedulingPolicies({ client: batch }, {})) {
        for (const policy of page.schedulingPolicies || []) {
          if (policy.arn) {
            const name = arnResourceName(policy.arn);
            this.add('aws_batch_scheduling_policy', policy.arn, name, { name, arn: policy.arn });
          }
        }
      }
    });
  }
}
