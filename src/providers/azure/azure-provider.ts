import { SubscriptionClient } from '@azure/arm-resources-subscriptions';
import { BaseProvider, BaseService } from '../../core/provider';
import { Logger, ProviderConfig, ProviderData, ResourceConnection } from '../../types';
import { AZURE_SERVICES } from './services';
import { azureCredential } from './azure-service';

/**
 * Azure (azurerm) provider. Config keys: `subscriptionId` (falls back to ARM_SUBSCRIPTION_ID,
 * AZURE_SUBSCRIPTION_ID, then the only enabled subscription of the signed-in identity) and
 * `resourceGroup` (optional filter). Authentication uses DefaultAzureCredential
 * (environment variables, workload/managed identity, Azure CLI, ...).
 */
export class AzureProvider extends BaseProvider {
  constructor(config: ProviderConfig, logger: Logger) {
    super('azurerm', config, logger);
  }

  /** args: [subscriptionId] */
  async init(args: string[]): Promise<void> {
    if (args.length > 0 && args[0]) {
      this.config.subscriptionId = args[0];
    }
    this.config.subscriptionId = await resolveSubscriptionId(this.config, this.logger);
  }

  getScope(): string {
    return this.config.subscriptionId || 'default';
  }

  getSupportedServices(): Record<string, typeof BaseService> {
    return AZURE_SERVICES;
  }

  getResourceConnections(): ResourceConnection {
    return {};
  }

  getProviderData(): ProviderData {
    const azurerm: Record<string, any> = { features: {} };
    if (this.config.subscriptionId) {
      azurerm.subscription_id = this.config.subscriptionId;
    }
    return {
      provider: { azurerm },
      terraform: {
        required_providers: [{
          azurerm: {
            source: 'hashicorp/azurerm',
            version: '~> 4.0'
          }
        }]
      }
    };
  }

  getConfig(): Record<string, any> {
    return this.config.subscriptionId ? { subscription_id: this.config.subscriptionId } : {};
  }
}

/**
 * The subscription to import: explicit config, ARM_SUBSCRIPTION_ID, AZURE_SUBSCRIPTION_ID, or the
 * single enabled subscription visible to the credential.
 */
export async function resolveSubscriptionId(config: ProviderConfig, logger: Logger): Promise<string> {
  const explicit = config.subscriptionId || process.env.ARM_SUBSCRIPTION_ID || process.env.AZURE_SUBSCRIPTION_ID;
  if (explicit) {
    return String(explicit).trim();
  }
  const client = new SubscriptionClient(azureCredential(config));
  const enabled: Array<{ id: string; name?: string }> = [];
  for await (const subscription of client.subscriptions.list()) {
    if (subscription.subscriptionId && subscription.state === 'Enabled') {
      enabled.push({ id: subscription.subscriptionId, name: subscription.displayName });
    }
  }
  if (enabled.length === 1) {
    logger.info(`Using Azure subscription ${enabled[0].name ? `${enabled[0].name} ` : ''}(${enabled[0].id})`);
    return enabled[0].id;
  }
  const choices = enabled.map(subscription => `${subscription.id}${subscription.name ? ` (${subscription.name})` : ''}`);
  throw new Error(enabled.length === 0
    ? 'No enabled Azure subscription found for the current credentials. Pass --subscription <id> or set ARM_SUBSCRIPTION_ID.'
    : `Several Azure subscriptions are available; pass --subscription <id> (or set ARM_SUBSCRIPTION_ID). Available: ${choices.join(', ')}`);
}
