import { BaseService } from '../../../core/provider';
import { TerraformResource, ResourceFilter, ProviderConfig, Logger } from '../../../types';

export class ECSService extends BaseService {
  async initResources(): Promise<void> {
    this.log('ECS service not yet implemented', 'warn');
  }

  parseFilter(rawFilter: string): ResourceFilter[] {
    return [];
  }

  async postConvertHook(): Promise<void> {
    this.log('Running ECS post-conversion hook...', 'debug');
  }
}


