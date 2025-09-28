import { BaseService } from '../../../core/provider';
import { TerraformResource, ResourceFilter, ProviderConfig, Logger } from '../../../types';

export class DynamoDBService extends BaseService {
  async initResources(): Promise<void> {
    this.log('DynamoDB service not yet implemented', 'warn');
  }

  parseFilter(rawFilter: string): ResourceFilter[] {
    return [];
  }

  async postConvertHook(): Promise<void> {
    this.log('Running DynamoDB post-conversion hook...', 'debug');
  }
}


