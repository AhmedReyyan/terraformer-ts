import {
  CloudFormationClient,
  CallAs,
  StackStatus,
  paginateListStackInstances,
  paginateListStackSets,
  paginateListStacks
} from '@aws-sdk/client-cloudformation';
import { mapLimit } from '../../../core/provider';
import { AwsService } from '../aws-service';

/** Stacks that were deleted, failed to create, or never got past a change set review. */
const SKIPPED_STATUSES = new Set<string>([
  'DELETE_COMPLETE', 'DELETE_IN_PROGRESS', 'DELETE_FAILED',
  'CREATE_FAILED', 'ROLLBACK_IN_PROGRESS', 'ROLLBACK_COMPLETE', 'ROLLBACK_FAILED',
  'REVIEW_IN_PROGRESS'
]);
const LISTED_STATUSES = Object.values(StackStatus).filter(status => !SKIPPED_STATUSES.has(status));

/**
 * Stacks owned by another resource: StackSet instances (`StackSet-`, managed by the stack set)
 * and Elastic Beanstalk environments (`awseb-`).
 */
const isOwnedStack = (name: string): boolean => name.startsWith('StackSet-') || name.startsWith('awseb-');

interface StackSetRef {
  name: string;
  callAs: CallAs;
  permissionModel?: string;
}

export class CloudFormationService extends AwsService {
  async initResources(): Promise<void> {
    const cloudformation = this.client(CloudFormationClient);

    await this.collect('CloudFormation stacks', async () => {
      for await (const page of paginateListStacks({ client: cloudformation }, { StackStatusFilter: LISTED_STATUSES })) {
        for (const stack of page.StackSummaries || []) {
          const name = stack.StackName;
          // Nested stacks (ParentId set) are part of their parent stack.
          if (!name || stack.ParentId || isOwnedStack(name) || SKIPPED_STATUSES.has(stack.StackStatus || '')) continue;
          this.add('aws_cloudformation_stack', name, name, { name, id: stack.StackId, status: stack.StackStatus });
        }
      }
    });

    const stackSets: StackSetRef[] = [];
    await this.collect('CloudFormation StackSets', async () => {
      const seen = new Set<string>();
      const list = async (callAs: CallAs): Promise<void> => {
        for await (const page of paginateListStackSets({ client: cloudformation }, { Status: 'ACTIVE', CallAs: callAs })) {
          for (const set of page.Summaries || []) {
            const name = set.StackSetName;
            if (!name || seen.has(name)) continue;
            seen.add(name);
            stackSets.push({ name, callAs, permissionModel: set.PermissionModel });
            // A stack set read as delegated administrator needs call_as in its import ID.
            const id = callAs === 'DELEGATED_ADMIN' ? `${name},DELEGATED_ADMIN` : name;
            this.add('aws_cloudformation_stack_set', id, name, {
              name,
              id: set.StackSetId,
              permission_model: set.PermissionModel,
              call_as: callAs
            });
          }
        }
      };
      await list('SELF');
      try {
        // Service-managed stack sets of a delegated administrator account are only listed with DELEGATED_ADMIN.
        await list('DELEGATED_ADMIN');
      } catch (error) {
        // Not a delegated administrator ("ValidationError: Account used is not a delegated administrator").
        if ((error as { name?: string }).name !== 'ValidationError') throw error;
      }
    });

    // Only self-managed instances: a service-managed instance resource targets organizational units and one
    // Terraform resource covers several accounts, which cannot be reconstructed reliably from the listing.
    const selfManaged = stackSets.filter(set => set.permissionModel !== 'SERVICE_MANAGED');
    await mapLimit(selfManaged, 5, set =>
      this.collect(`instances of StackSet ${set.name}`, async () => {
        for await (const page of paginateListStackInstances({ client: cloudformation }, { StackSetName: set.name, CallAs: set.callAs })) {
          for (const instance of page.Summaries || []) {
            // INOPERABLE instances failed to delete and are no longer managed by the stack set.
            if (!instance.Account || !instance.Region || instance.Status === 'INOPERABLE') continue;
            const id = [set.name, instance.Account, instance.Region, ...(set.callAs === 'DELEGATED_ADMIN' ? ['DELEGATED_ADMIN'] : [])].join(',');
            this.add('aws_cloudformation_stack_set_instance', id, `${set.name}-${instance.Account}-${instance.Region}`, {
              stack_set_name: set.name,
              account_id: instance.Account,
              region: instance.Region,
              stack_id: instance.StackId
            });
          }
        }
      })
    );
  }
}
