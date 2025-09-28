import { BaseService } from '../../../core/provider';
import { TerraformResource, ResourceFilter, ProviderConfig, Logger } from '../../../types';

export class CloudWatchLogsService extends BaseService {
  async initResources(): Promise<void> {
    this.log('CloudWatch Logs service not yet implemented', 'warn');
  }

  parseFilter(rawFilter: string): ResourceFilter[] {
    return [];
  }

  async postConvertHook(): Promise<void> {
    this.log('Running CloudWatch Logs post-conversion hook...', 'debug');
  }
}


