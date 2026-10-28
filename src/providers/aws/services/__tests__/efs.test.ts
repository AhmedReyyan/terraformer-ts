import { mockClient } from 'aws-sdk-client-mock';
import {
  EFSClient,
  DescribeFileSystemsCommand,
  DescribeMountTargetsCommand,
  DescribeAccessPointsCommand,
  DescribeFileSystemPolicyCommand,
  DescribeBackupPolicyCommand
} from '@aws-sdk/client-efs';
import { EFSService } from '../efs';
import { createService, importIds, notFound } from './helpers';

const efs = mockClient(EFSClient);

const fileSystem = (id: string, state: string) => ({
  FileSystemId: id, LifeCycleState: state as any, Name: id, Tags: [{ Key: 'Name', Value: id }],
  OwnerId: '123', CreationToken: id, CreationTime: new Date(), NumberOfMountTargets: 1,
  SizeInBytes: { Value: 0 }, PerformanceMode: 'generalPurpose' as const
});

beforeEach(() => {
  efs.reset();
  efs.on(DescribeMountTargetsCommand).resolves({ MountTargets: [] });
  efs.on(DescribeAccessPointsCommand).resolves({ AccessPoints: [] });
  efs.on(DescribeFileSystemPolicyCommand).rejects(notFound('PolicyNotFound'));
  efs.on(DescribeBackupPolicyCommand).rejects(notFound('PolicyNotFound'));
});

describe('EFSService', () => {
  it('imports file systems with mount targets, access points and policies', async () => {
    efs.on(DescribeFileSystemsCommand).resolvesOnce({ FileSystems: [fileSystem('fs-1', 'available')], NextMarker: 'm2' })
      .resolvesOnce({ FileSystems: [fileSystem('fs-2', 'deleting'), fileSystem('fs-3', 'available')] });
    efs.on(DescribeMountTargetsCommand, { FileSystemId: 'fs-1' }).resolves({
      MountTargets: [
        { MountTargetId: 'fsmt-1', FileSystemId: 'fs-1', SubnetId: 's', LifeCycleState: 'available', AvailabilityZoneName: 'us-east-1a' },
        { MountTargetId: 'fsmt-2', FileSystemId: 'fs-1', SubnetId: 's', LifeCycleState: 'deleting' }
      ]
    });
    efs.on(DescribeAccessPointsCommand, { FileSystemId: 'fs-1' }).resolves({
      AccessPoints: [{ AccessPointId: 'fsap-1', LifeCycleState: 'available' }]
    });
    efs.on(DescribeFileSystemPolicyCommand, { FileSystemId: 'fs-1' }).resolves({ FileSystemId: 'fs-1', Policy: '{}' });
    efs.on(DescribeBackupPolicyCommand, { FileSystemId: 'fs-1' }).resolves({ BackupPolicy: { Status: 'ENABLED' } });
    // A disabled backup policy is the default and is not imported.
    efs.on(DescribeBackupPolicyCommand, { FileSystemId: 'fs-3' }).resolves({ BackupPolicy: { Status: 'DISABLED' } });

    const service = createService(EFSService, 'efs');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_efs_access_point:fsap-1',
      'aws_efs_backup_policy:fs-1',
      'aws_efs_file_system:fs-1',
      'aws_efs_file_system:fs-3',
      'aws_efs_file_system_policy:fs-1',
      'aws_efs_mount_target:fsmt-1'
    ]);
    expect(efs.commandCalls(DescribeFileSystemsCommand)[1].args[0].input).toMatchObject({ Marker: 'm2' });
    expect(service.getResources().find(r => r.id === 'fs-1')!.attributes.tags).toEqual({ Name: 'fs-1' });
    expect(service.getWarnings()).toEqual([]);
  });
});
