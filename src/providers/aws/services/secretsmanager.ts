import { BaseService } from '../../../core/provider';
import { TerraformResource, ResourceFilter, ProviderConfig, Logger } from '../../../types';

export class SecretsManagerService extends BaseService {
  async initResources(): Promise<void> {
    this.log('Secrets Manager service not yet implemented', 'warn');
  }

  parseFilter(rawFilter: string): ResourceFilter[] {
    return [];
  }

  async postConvertHook(): Promise<void> {
    this.log('Running Secrets Manager post-conversion hook...', 'debug');
  }
}


