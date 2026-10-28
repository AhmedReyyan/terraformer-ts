import {
  S3Client,
  paginateListBuckets,
  GetBucketPolicyCommand,
  GetBucketVersioningCommand,
  GetBucketEncryptionCommand,
  GetPublicAccessBlockCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketCorsCommand,
  GetBucketWebsiteCommand,
  GetBucketLoggingCommand,
  GetBucketOwnershipControlsCommand,
  GetBucketNotificationConfigurationCommand,
  Bucket
} from '@aws-sdk/client-s3';
import { mapLimit, describeError } from '../../../core/provider';
import { AwsService, optional } from '../aws-service';

/**
 * S3 buckets in the current region, plus the bucket configuration resources that
 * AWS provider v4+ manages separately from aws_s3_bucket.
 */
export class S3Service extends AwsService {
  async initResources(): Promise<void> {
    const s3 = this.client(S3Client);
    const buckets: Bucket[] = [];

    await this.collect('S3 buckets', async () => {
      for await (const page of paginateListBuckets({ client: s3 }, { BucketRegion: this.region })) {
        for (const bucket of page.Buckets || []) {
          // ListBuckets is global; only keep buckets that live in this region.
          if (bucket.Name && (!bucket.BucketRegion || bucket.BucketRegion === this.region)) {
            buckets.push(bucket);
          }
        }
      }
    });

    await mapLimit(buckets, 8, async bucket => {
      const name = bucket.Name!;
      this.add('aws_s3_bucket', name, name, {
        bucket: name,
        creation_date: bucket.CreationDate?.toISOString()
      });
      try {
        await this.loadBucketConfiguration(s3, name);
      } catch (error) {
        this.warn(`bucket ${name} configuration: ${describeError(error)}`);
      }
    });
  }

  private async loadBucketConfiguration(s3: S3Client, bucket: string): Promise<void> {
    const [
      policy, versioning, encryption, publicAccessBlock, lifecycle,
      cors, website, logging, ownership, notification
    ] = await Promise.all([
      optional(s3.send(new GetBucketPolicyCommand({ Bucket: bucket }))),
      optional(s3.send(new GetBucketVersioningCommand({ Bucket: bucket }))),
      optional(s3.send(new GetBucketEncryptionCommand({ Bucket: bucket }))),
      optional(s3.send(new GetPublicAccessBlockCommand({ Bucket: bucket }))),
      optional(s3.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }))),
      optional(s3.send(new GetBucketCorsCommand({ Bucket: bucket }))),
      optional(s3.send(new GetBucketWebsiteCommand({ Bucket: bucket }))),
      optional(s3.send(new GetBucketLoggingCommand({ Bucket: bucket }))),
      optional(s3.send(new GetBucketOwnershipControlsCommand({ Bucket: bucket }))),
      optional(s3.send(new GetBucketNotificationConfigurationCommand({ Bucket: bucket })))
    ]);

    // All of these resources are imported by bucket name.
    if (policy?.Policy) {
      this.add('aws_s3_bucket_policy', bucket, bucket, { bucket });
    }
    if (versioning?.Status) {
      this.add('aws_s3_bucket_versioning', bucket, bucket, { bucket, status: versioning.Status });
    }
    if (encryption?.ServerSideEncryptionConfiguration?.Rules?.length) {
      this.add('aws_s3_bucket_server_side_encryption_configuration', bucket, bucket, { bucket });
    }
    if (publicAccessBlock?.PublicAccessBlockConfiguration) {
      this.add('aws_s3_bucket_public_access_block', bucket, bucket, { bucket });
    }
    if (lifecycle?.Rules?.length) {
      this.add('aws_s3_bucket_lifecycle_configuration', bucket, bucket, { bucket });
    }
    if (cors?.CORSRules?.length) {
      this.add('aws_s3_bucket_cors_configuration', bucket, bucket, { bucket });
    }
    if (website && (website.IndexDocument || website.RedirectAllRequestsTo)) {
      this.add('aws_s3_bucket_website_configuration', bucket, bucket, { bucket });
    }
    if (logging?.LoggingEnabled) {
      this.add('aws_s3_bucket_logging', bucket, bucket, { bucket });
    }
    if (ownership?.OwnershipControls?.Rules?.length) {
      this.add('aws_s3_bucket_ownership_controls', bucket, bucket, { bucket });
    }
    if (notification && (
      notification.TopicConfigurations?.length ||
      notification.QueueConfigurations?.length ||
      notification.LambdaFunctionConfigurations?.length ||
      notification.EventBridgeConfiguration
    )) {
      this.add('aws_s3_bucket_notification', bucket, bucket, { bucket });
    }
  }
}
