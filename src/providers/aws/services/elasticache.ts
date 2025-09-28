import { BaseService } from '../../../core/provider';
import { TerraformResource, ResourceFilter, ProviderConfig, Logger } from '../../../types';

export class ElastiCacheService extends BaseService {
  async initResources(): Promise<void> {
    this.log('ElastiCache service not yet implemented', 'warn');
  }

  parseFilter(rawFilter: string): ResourceFilter[] {
    return [];
  }

  async postConvertHook(): Promise<void> {
    this.log('Running ElastiCache post-conversion hook...', 'debug');
  }
}


