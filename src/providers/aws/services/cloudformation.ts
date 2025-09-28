import { BaseService } from '../../../core/provider';
import { TerraformResource, ResourceFilter, ProviderConfig, Logger } from '../../../types';

export class CloudFormationService extends BaseService {
  async initResources(): Promise<void> {
    this.log('CloudFormation service not yet implemented', 'warn');
  }

  parseFilter(rawFilter: string): ResourceFilter[] {
    return [];
  }

  async postConvertHook(): Promise<void> {
    this.log('Running CloudFormation post-conversion hook...', 'debug');
  }
}


