import { BaseService } from '../../../core/provider';
import { TerraformResource, ResourceFilter, ProviderConfig, Logger } from '../../../types';

export class EKSService extends BaseService {
  async initResources(): Promise<void> {
    this.log('EKS service not yet implemented', 'warn');
  }

  parseFilter(rawFilter: string): ResourceFilter[] {
    return [];
  }

  async postConvertHook(): Promise<void> {
    this.log('Running EKS post-conversion hook...', 'debug');
  }
}


