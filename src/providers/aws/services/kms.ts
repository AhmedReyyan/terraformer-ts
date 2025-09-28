import { BaseService } from '../../../core/provider';
import { TerraformResource, ResourceFilter, ProviderConfig, Logger } from '../../../types';

export class KMSService extends BaseService {
  async initResources(): Promise<void> {
    this.log('KMS service not yet implemented', 'warn');
  }

  parseFilter(rawFilter: string): ResourceFilter[] {
    return [];
  }

  async postConvertHook(): Promise<void> {
    this.log('Running KMS post-conversion hook...', 'debug');
  }
}


