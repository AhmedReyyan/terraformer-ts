import { BaseService } from '../../../core/provider';
import { S3Service } from './s3';
import { IAMService } from './iam';
import { SQSService } from './sqs';

export { S3Service, IAMService, SQSService };

/** CLI service name -> service implementation. */
export const AWS_SERVICES: Record<string, typeof BaseService> = {
  iam: IAMService,
  s3: S3Service,
  sqs: SQSService
};
