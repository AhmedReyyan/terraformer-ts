import { BaseService } from '../../../core/provider';
import { TerraformResource, ResourceFilter, ProviderConfig, Logger } from '../../../types';

export class ELBService extends BaseService {
  async initResources(): Promise<void> {
    this.log('ELB service not yet implemented', 'warn');
  }

  parseFilter(rawFilter: string): ResourceFilter[] {
    return [];
  }

  async postConvertHook(): Promise<void> {
    this.log('Running ELB post-conversion hook...', 'debug');
  }
}


