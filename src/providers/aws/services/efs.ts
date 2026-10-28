import {
  EFSClient,
  paginateDescribeFileSystems,
  paginateDescribeMountTargets,
  paginateDescribeAccessPoints,
  DescribeFileSystemPolicyCommand,
  DescribeBackupPolicyCommand,
  FileSystemDescription
} from '@aws-sdk/client-efs';
import { mapLimit } from '../../../core/provider';
import { AwsService, optional, tagMap } from '../aws-service';

const SKIPPED_STATES = ['deleting', 'deleted', 'error'];

/**
 * EFS file systems with their mount targets, access points, file system policy and
 * backup policy. aws_efs_file_system has no inline policy or backup arguments, so the
 * standalone resources do not overlap with it.
 */
export class EFSService extends AwsService {
  async initResources(): Promise<void> {
    const efs = this.client(EFSClient);
    const fileSystems: FileSystemDescription[] = [];

    await this.collect('EFS file systems', async () => {
      for await (const page of paginateDescribeFileSystems({ client: efs }, {})) {
        for (const fs of page.FileSystems || []) {
          // Skip file systems being deleted or in an error state.
          if (!fs.FileSystemId || SKIPPED_STATES.includes(fs.LifeCycleState || '')) {
            continue;
          }
          fileSystems.push(fs);
          this.add('aws_efs_file_system', fs.FileSystemId, fs.Name || fs.FileSystemId, {
            id: fs.FileSystemId,
            arn: fs.FileSystemArn,
            name: fs.Name,
            tags: tagMap(fs.Tags)
          });
        }
      }
    });

    await mapLimit(fileSystems, 5, async fs => {
      const id = fs.FileSystemId!;
      const name = fs.Name || id;

      await this.collect(`EFS mount targets of ${id}`, async () => {
        for await (const page of paginateDescribeMountTargets({ client: efs }, { FileSystemId: id })) {
          for (const target of page.MountTargets || []) {
            if (!target.MountTargetId || SKIPPED_STATES.includes(target.LifeCycleState || '')) {
              continue;
            }
            this.add('aws_efs_mount_target', target.MountTargetId, `${name}-${target.AvailabilityZoneName || target.MountTargetId}`, {
              id: target.MountTargetId,
              file_system_id: id,
              subnet_id: target.SubnetId
            });
          }
        }
      });

      await this.collect(`EFS access points of ${id}`, async () => {
        for await (const page of paginateDescribeAccessPoints({ client: efs }, { FileSystemId: id })) {
          for (const accessPoint of page.AccessPoints || []) {
            if (!accessPoint.AccessPointId || SKIPPED_STATES.includes(accessPoint.LifeCycleState || '')) {
              continue;
            }
            this.add('aws_efs_access_point', accessPoint.AccessPointId, accessPoint.Name || accessPoint.AccessPointId, {
              id: accessPoint.AccessPointId,
              arn: accessPoint.AccessPointArn,
              file_system_id: id,
              tags: tagMap(accessPoint.Tags)
            });
          }
        }
      });

      await this.collect(`EFS policies of ${id}`, async () => {
        const [policy, backup] = await Promise.all([
          optional(efs.send(new DescribeFileSystemPolicyCommand({ FileSystemId: id }))),
          optional(efs.send(new DescribeBackupPolicyCommand({ FileSystemId: id })))
        ]);
        if (policy?.Policy) {
          this.add('aws_efs_file_system_policy', id, name, { file_system_id: id });
        }
        // A DISABLED backup policy is the default state of a file system, so only
        // enabled (or enabling) automatic backups are imported.
        const status = backup?.BackupPolicy?.Status;
        if (status === 'ENABLED' || status === 'ENABLING') {
          this.add('aws_efs_backup_policy', id, name, { file_system_id: id, status });
        }
      });
    });
  }
}
