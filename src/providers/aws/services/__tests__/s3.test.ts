import { mockClient } from 'aws-sdk-client-mock';
import {
  S3Client,
  ListBucketsCommand,
  GetBucketPolicyCommand,
  GetBucketVersioningCommand,
  GetBucketEncryptionCommand,
  GetPublicAccessBlockCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketCorsCommand,
  GetBucketWebsiteCommand,
  GetBucketLoggingCommand,
  GetBucketOwnershipControlsCommand,
  GetBucketNotificationConfigurationCommand
} from '@aws-sdk/client-s3';
import { S3Service } from '../s3';
import { createService, notFound, importIds } from './helpers';

const s3 = mockClient(S3Client);

beforeEach(() => {
  s3.reset();
  for (const command of [
    GetBucketPolicyCommand, GetBucketEncryptionCommand, GetPublicAccessBlockCommand,
    GetBucketLifecycleConfigurationCommand, GetBucketCorsCommand, GetBucketWebsiteCommand,
    GetBucketOwnershipControlsCommand
  ]) {
    s3.on(command as any).rejects(notFound('NoSuchConfiguration'));
  }
  s3.on(GetBucketVersioningCommand).resolves({});
  s3.on(GetBucketLoggingCommand).resolves({});
  s3.on(GetBucketNotificationConfigurationCommand).resolves({});
});

describe('S3Service', () => {
  it('imports buckets in the current region with their configuration resources', async () => {
    s3.on(ListBucketsCommand).resolves({
      Buckets: [
        { Name: 'app-logs', BucketRegion: 'eu-west-1' },
        { Name: 'other-region', BucketRegion: 'us-east-1' }
      ]
    });
    s3.on(GetBucketVersioningCommand, { Bucket: 'app-logs' }).resolves({ Status: 'Enabled' });
    s3.on(GetBucketPolicyCommand, { Bucket: 'app-logs' }).resolves({ Policy: '{}' });
    s3.on(GetBucketEncryptionCommand, { Bucket: 'app-logs' }).resolves({
      ServerSideEncryptionConfiguration: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] }
    });

    const service = createService(S3Service, 's3', 'eu-west-1');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_s3_bucket:app-logs',
      'aws_s3_bucket_policy:app-logs',
      'aws_s3_bucket_server_side_encryption_configuration:app-logs',
      'aws_s3_bucket_versioning:app-logs'
    ]);
    expect(s3.commandCalls(ListBucketsCommand)[0].args[0].input).toMatchObject({ BucketRegion: 'eu-west-1' });
    expect(service.getWarnings()).toEqual([]);
  });

  it('keeps the bucket and records a warning when its configuration cannot be read', async () => {
    s3.on(ListBucketsCommand).resolves({ Buckets: [{ Name: 'locked', BucketRegion: 'eu-west-1' }] });
    s3.on(GetBucketVersioningCommand).rejects(Object.assign(new Error('Access Denied'), { name: 'AccessDenied' }));

    const service = createService(S3Service, 's3', 'eu-west-1');
    await service.initResources();

    expect(importIds(service)).toEqual(['aws_s3_bucket:locked']);
    expect(service.getWarnings()[0]).toContain('AccessDenied');
  });
});
