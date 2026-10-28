import {
  SSMClient,
  paginateDescribeParameters,
  paginateListDocuments,
  paginateDescribeMaintenanceWindows,
  paginateDescribeMaintenanceWindowTargets,
  paginateDescribeMaintenanceWindowTasks,
  paginateListAssociations,
  paginateDescribePatchBaselines,
  paginateDescribePatchGroups
} from '@aws-sdk/client-ssm';
import { mapLimit } from '../../../core/provider';
import { AwsService, tagMap } from '../aws-service';

/** Systems Manager parameters, documents, maintenance windows, associations and patching. */
export class SSMService extends AwsService {
  async initResources(): Promise<void> {
    const ssm = this.client(SSMClient);

    await this.collect('SSM parameters', async () => {
      for await (const page of paginateDescribeParameters({ client: ssm }, {})) {
        for (const parameter of page.Parameters || []) {
          // The import ID is the full name, including any `/` path separators.
          if (parameter.Name) {
            this.add('aws_ssm_parameter', parameter.Name, parameter.Name, {
              name: parameter.Name,
              arn: parameter.ARN,
              type: parameter.Type,
              tier: parameter.Tier
            });
          }
        }
      }
    });

    await this.collect('SSM documents', async () => {
      // Only documents owned by this account (not AWS or shared documents).
      const filters = [{ Key: 'Owner', Values: ['Self'] }];
      for await (const page of paginateListDocuments({ client: ssm }, { Filters: filters })) {
        for (const document of page.DocumentIdentifiers || []) {
          if (document.Name) {
            this.add('aws_ssm_document', document.Name, document.Name, {
              name: document.Name,
              document_type: document.DocumentType,
              tags: tagMap(document.Tags)
            });
          }
        }
      }
    });

    await this.collect('SSM maintenance windows', async () => {
      const windows: Array<{ id: string; name: string }> = [];
      for await (const page of paginateDescribeMaintenanceWindows({ client: ssm }, {})) {
        for (const window of page.WindowIdentities || []) {
          if (window.WindowId) {
            const name = window.Name || window.WindowId;
            windows.push({ id: window.WindowId, name });
            this.add('aws_ssm_maintenance_window', window.WindowId, name, { id: window.WindowId, name: window.Name });
          }
        }
      }
      await mapLimit(windows, 5, async window => {
        await this.collect(`SSM maintenance window ${window.id} targets`, async () => {
          for await (const page of paginateDescribeMaintenanceWindowTargets({ client: ssm }, { WindowId: window.id })) {
            for (const target of page.Targets || []) {
              if (target.WindowTargetId) {
                this.add('aws_ssm_maintenance_window_target', `${window.id}/${target.WindowTargetId}`,
                  `${window.name}-${target.Name || target.WindowTargetId}`,
                  { window_id: window.id, id: target.WindowTargetId, name: target.Name });
              }
            }
          }
        });
        await this.collect(`SSM maintenance window ${window.id} tasks`, async () => {
          for await (const page of paginateDescribeMaintenanceWindowTasks({ client: ssm }, { WindowId: window.id })) {
            for (const task of page.Tasks || []) {
              if (task.WindowTaskId) {
                this.add('aws_ssm_maintenance_window_task', `${window.id}/${task.WindowTaskId}`,
                  `${window.name}-${task.Name || task.WindowTaskId}`,
                  { window_id: window.id, id: task.WindowTaskId, name: task.Name, task_arn: task.TaskArn });
              }
            }
          }
        });
      });
    });

    await this.collect('SSM associations', async () => {
      for await (const page of paginateListAssociations({ client: ssm }, {})) {
        for (const association of page.Associations || []) {
          if (association.AssociationId) {
            this.add('aws_ssm_association', association.AssociationId,
              association.AssociationName || association.Name || association.AssociationId,
              { association_id: association.AssociationId, name: association.Name, association_name: association.AssociationName });
          }
        }
      }
    });

    await this.collect('SSM patch baselines', async () => {
      // OWNER Self excludes the AWS-provided predefined baselines.
      const filters = [{ Key: 'OWNER', Values: ['Self'] }];
      for await (const page of paginateDescribePatchBaselines({ client: ssm }, { Filters: filters })) {
        for (const baseline of page.BaselineIdentities || []) {
          if (baseline.BaselineId) {
            this.add('aws_ssm_patch_baseline', baseline.BaselineId, baseline.BaselineName || baseline.BaselineId, {
              id: baseline.BaselineId,
              name: baseline.BaselineName,
              operating_system: baseline.OperatingSystem
            });
          }
        }
      }
    });

    await this.collect('SSM patch groups', async () => {
      for await (const page of paginateDescribePatchGroups({ client: ssm }, {})) {
        for (const mapping of page.Mappings || []) {
          const baselineId = mapping.BaselineIdentity?.BaselineId;
          if (mapping.PatchGroup && baselineId) {
            this.add('aws_ssm_patch_group', `${mapping.PatchGroup},${baselineId}`, mapping.PatchGroup, {
              patch_group: mapping.PatchGroup,
              baseline_id: baselineId
            });
          }
        }
      }
    });
  }
}
