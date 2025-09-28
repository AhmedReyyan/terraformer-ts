import { BaseService } from '../../../core/provider';
import { TerraformResource, ResourceFilter, ProviderConfig, Logger } from '../../../types';

export class KinesisService extends BaseService {
  async initResources(): Promise<void> {
    this.log('Kinesis service not yet implemented', 'warn');
  }

  parseFilter(rawFilter: string): ResourceFilter[] {
    return [];
  }

  async postConvertHook(): Promise<void> {
    this.log('Running Kinesis post-conversion hook...', 'debug');
  }
}


