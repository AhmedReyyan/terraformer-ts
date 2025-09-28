import { BaseService } from '../../../core/provider';
import { TerraformResource, ResourceFilter, ProviderConfig, Logger } from '../../../types';

export class ElasticsearchService extends BaseService {
  async initResources(): Promise<void> {
    this.log('Elasticsearch service not yet implemented', 'warn');
  }

  parseFilter(rawFilter: string): ResourceFilter[] {
    return [];
  }

  async postConvertHook(): Promise<void> {
    this.log('Running Elasticsearch post-conversion hook...', 'debug');
  }
}


