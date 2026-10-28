import { GoogleAuth } from 'google-auth-library';
import { BaseProvider, BaseService } from '../../core/provider';
import { Logger, ProviderConfig, ProviderData, ResourceConnection } from '../../types';
import { GOOGLE_SERVICES } from './services';

const PROJECT_ENV_VARS = ['GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT', 'CLOUDSDK_CORE_PROJECT'];

/**
 * Google Cloud provider. The scope is one project; authentication uses
 * Application Default Credentials (both for discovery and for the terraform CLI).
 */
export class GoogleProvider extends BaseProvider {
  private project = '';

  constructor(config: ProviderConfig, logger: Logger) {
    super('google', config, logger);
  }

  /** args: [project] — called once per project when several are requested. */
  async init(args: string[]): Promise<void> {
    this.project = args[0] || this.config.project || await this.detectProject();
    this.config.project = this.project;
  }

  private async detectProject(): Promise<string> {
    for (const name of PROJECT_ENV_VARS) {
      const value = process.env[name];
      if (value) {
        return value;
      }
    }
    try {
      const project = await new GoogleAuth().getProjectId();
      if (project) {
        return project;
      }
    } catch (error) {
      this.logger.debug(`google: could not detect the project from credentials: ${String(error)}`);
    }
    throw new Error(
      'google: no project specified. Pass --projects <project-id>, set GOOGLE_CLOUD_PROJECT, ' +
      'or run "gcloud config set project <project-id>".'
    );
  }

  getScope(): string {
    return this.project;
  }

  getSupportedServices(): Record<string, typeof BaseService> {
    return GOOGLE_SERVICES;
  }

  getResourceConnections(): ResourceConnection {
    return {};
  }

  getProviderData(): ProviderData {
    return {
      provider: {
        google: { project: this.project }
      },
      terraform: {
        required_providers: [{
          google: {
            source: 'hashicorp/google',
            version: '~> 7.0'
          }
        }]
      }
    };
  }

  getConfig(): Record<string, any> {
    return { project: this.project };
  }
}
