// Main exports for the Terraformer TypeScript library
export { BaseProvider, BaseService } from './core/provider';
export { Terraformer } from './core/terraformer';
export { HclGenerator } from './core/hcl-generator';
export { TerraformerLogger, ConsoleLogger } from './core/logger';

// AWS Provider
export { AWSProvider } from './providers/aws/aws-provider';
export * from './providers/aws/services';
//alternative actions
// Types
export * from './types';

// CLI is available separately via dist/cli.js
