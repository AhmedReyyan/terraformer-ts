import { BaseProvider } from '../core/provider';
import { Logger, ProviderConfig } from '../types';

export const SUPPORTED_PROVIDERS = ['aws', 'azure', 'google'] as const;
export type ProviderName = typeof SUPPORTED_PROVIDERS[number];

const ALIASES: Record<string, ProviderName> = {
  aws: 'aws',
  azure: 'azure',
  azurerm: 'azure',
  google: 'google',
  gcp: 'google'
};

export function resolveProviderName(name: string): ProviderName | undefined {
  return ALIASES[name.toLowerCase()];
}

/**
 * Create a provider by name. Providers are loaded lazily so that using one cloud
 * does not load the SDKs of the others.
 */
export async function createProvider(name: string, config: ProviderConfig, logger: Logger): Promise<BaseProvider> {
  switch (resolveProviderName(name)) {
    case 'aws': {
      const { AWSProvider } = await import('./aws/aws-provider');
      return new AWSProvider(config, logger);
    }
    case 'azure': {
      const { AzureProvider } = await import('./azure/azure-provider');
      return new AzureProvider(config, logger);
    }
    case 'google': {
      const { GoogleProvider } = await import('./google/google-provider');
      return new GoogleProvider(config, logger);
    }
    default:
      throw new Error(`Unsupported provider "${name}". Supported providers: ${SUPPORTED_PROVIDERS.join(', ')}`);
  }
}
