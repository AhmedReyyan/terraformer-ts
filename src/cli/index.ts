#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import * as fs from 'fs';
import * as path from 'path';
import { Terraformer } from '../core/terraformer';
import { ConsoleLogger } from '../core/logger';
import { ImportOptions, ImportResult, ProviderConfig } from '../types';
import { createProvider, resolveProviderName, SUPPORTED_PROVIDERS, ProviderName } from '../providers';

const program = new Command();

program
  .name('terraformer')
  .description('Generate Terraform configurations from existing cloud infrastructure')
  .version(readVersion());

interface CliOptions {
  resources: string;
  excludes?: string;
  output: string;
  pathPattern?: string;
  region?: string;
  profile?: string;
  subscription?: string;
  resourceGroup?: string;
  projects?: string;
  filter: string[];
  filters?: string;
  compact?: boolean;
  json?: boolean;
  verbose?: boolean;
  sort: boolean;
  generate: boolean;
  terraformBin?: string;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function list(value?: string): string[] | undefined {
  return value?.split(',').map(v => v.trim()).filter(Boolean);
}

function addCommonOptions(command: Command, provider: ProviderName): Command {
  command
    .option('-r, --resources <services>', 'Comma-separated services to import, or "*" for all', '*')
    .option('-x, --excludes <services>', 'Comma-separated services to skip')
    .option('-o, --output <path>', 'Output directory', 'generated')
    .option('-p, --path-pattern <pattern>', 'Output path pattern (placeholders: {output} {provider} {region} {service})')
    .option('-f, --filter <filter>', 'Resource filter, e.g. "aws_s3_bucket=b1:b2" or "Type=ec2;Name=tags.Env;Value=prod" (repeatable)', collect, [])
    .option('--filters <filters>', 'Comma-separated resource filters')
    .option('--compact', 'Write all services into one directory per region')
    .option('--json', 'Write provider and import blocks in Terraform JSON syntax')
    .option('--no-sort', 'Keep import blocks in discovery order')
    .option('--no-generate', 'Only write import blocks; skip "terraform plan -generate-config-out"')
    .option('--terraform-bin <path>', 'Path to the terraform binary', 'terraform')
    .option('-v, --verbose', 'Verbose output');

  switch (provider) {
    case 'aws':
      command
        .option('--region <regions>', 'AWS region(s), comma-separated', process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1')
        .option('--profile <profile>', 'AWS shared config profile', process.env.AWS_PROFILE || 'default');
      break;
    case 'azure':
      command
        .option('--subscription <id>', 'Azure subscription ID (defaults to ARM_SUBSCRIPTION_ID / AZURE_SUBSCRIPTION_ID)')
        .option('--resource-group <name>', 'Only import resources in this resource group');
      break;
    case 'google':
      command
        .option('--projects <projects>', 'GCP project ID(s), comma-separated (defaults to GOOGLE_CLOUD_PROJECT)');
      break;
  }
  return command;
}

function buildProviderConfig(provider: ProviderName, options: CliOptions): ProviderConfig {
  switch (provider) {
    case 'aws':
      return { region: list(options.region)?.[0], profile: options.profile };
    case 'azure':
      return { subscriptionId: options.subscription, resourceGroup: options.resourceGroup };
    case 'google':
      return { project: list(options.projects)?.[0] };
  }
}

function buildImportOptions(provider: ProviderName, options: CliOptions): ImportOptions {
  return {
    resources: list(options.resources) || ['*'],
    excludes: list(options.excludes),
    pathOutput: options.output,
    pathPattern: options.pathPattern,
    regions: provider === 'aws' ? list(options.region) : undefined,
    projects: provider === 'google' ? list(options.projects) : undefined,
    profile: options.profile,
    resourceGroup: options.resourceGroup,
    filters: [...options.filter, ...(list(options.filters) || [])],
    compact: options.compact,
    output: options.json ? 'json' : 'hcl',
    verbose: options.verbose,
    noSort: options.sort === false,
    // undefined = generate when Terraform is installed.
    generate: options.generate === false ? false : undefined,
    terraformBin: options.terraformBin
  };
}

async function runImport(providerName: ProviderName, options: CliOptions): Promise<void> {
  const logger = new ConsoleLogger(options.verbose);
  const provider = await createProvider(providerName, buildProviderConfig(providerName, options), logger);
  const terraformer = new Terraformer(provider, logger);
  const spinner = options.verbose ? null : ora(`Importing ${providerName} resources...`).start();
  if (spinner) {
    silenceInfo(logger);
  }

  try {
    const result = await terraformer.import(buildImportOptions(providerName, options), (message, current, total) => {
      if (spinner) {
        spinner.text = `${message} (${current}/${total})`;
      }
    });
    spinner?.stop();
    printSummary(result);
  } catch (error) {
    spinner?.fail(chalk.red('Import failed'));
    throw error;
  }
}

function printSummary(result: ImportResult): void {
  console.log(chalk.green(`\nDiscovered ${result.resources.length} resources.`));

  for (const directory of result.directories) {
    const status = directory.generation === 'succeeded' ? chalk.green('config generated')
      : directory.generation === 'failed' ? chalk.yellow('needs review')
        : chalk.gray('import blocks only');
    console.log(`  ${directory.path}  ${chalk.gray(`${directory.resourceCount} resources`)}  ${status}`);
  }

  if (result.warnings.length > 0) {
    console.log(chalk.yellow(`\n${result.warnings.length} warning(s):`));
    for (const warning of result.warnings) {
      console.log(chalk.yellow(`  - ${warning}`));
    }
  }

  if (result.directories.length === 0) {
    return;
  }
  const generated = result.directories.some(d => d.generation !== 'skipped');
  console.log(chalk.blue('\nNext steps, in each output directory:'));
  if (!generated) {
    console.log(chalk.gray('  terraform init'));
    console.log(chalk.gray('  terraform plan -generate-config-out=generated.tf   # writes the resource blocks'));
  }
  console.log(chalk.gray('  review generated.tf, then:'));
  console.log(chalk.gray('  terraform plan    # should only show imports'));
  console.log(chalk.gray('  terraform apply   # records the imported resources in Terraform state'));
}

/** While the spinner runs, info logs would garble it; warnings are shown in the summary. */
function silenceInfo(logger: ConsoleLogger): void {
  logger.info = () => {};
  logger.warn = () => {};
}

function addProviderCommand(name: string, provider: ProviderName, description: string, aliases: string[] = []): void {
  const command = program.command(name).description(description);
  aliases.forEach(alias => command.alias(alias));
  addCommonOptions(command, provider).action(async (options: CliOptions) => {
    try {
      await runImport(provider, options);
    } catch (error) {
      console.error(chalk.red('Import failed:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
}

addProviderCommand('aws', 'aws', 'Import AWS resources');
addProviderCommand('azure', 'azure', 'Import Azure resources', ['azurerm']);
addProviderCommand('google', 'google', 'Import Google Cloud resources', ['gcp']);

// Plan Command
const planCommand = program
  .command('plan <provider>')
  .description('Discover resources and write them to plan.json without generating Terraform files');
// `plan` accepts the flags of every provider.
addCommonOptions(planCommand, 'aws');
planCommand
  .option('--subscription <id>', 'Azure subscription ID')
  .option('--resource-group <name>', 'Azure resource group')
  .option('--projects <projects>', 'GCP project ID(s), comma-separated')
  .action(async (providerArg: string, options: CliOptions) => {
    try {
      const providerName = resolveProviderName(providerArg);
      if (!providerName) {
        throw new Error(`Unsupported provider "${providerArg}". Supported providers: ${SUPPORTED_PROVIDERS.join(', ')}`);
      }
      const logger = new ConsoleLogger(options.verbose);
      const provider = await createProvider(providerName, buildProviderConfig(providerName, options), logger);
      const result = await new Terraformer(provider, logger).plan(buildImportOptions(providerName, options));
      console.log(chalk.green(`Plan generated successfully: ${result.resources.length} resources.`));
    } catch (error) {
      console.error(chalk.red('Plan generation failed:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// List Command
program
  .command('list <provider>')
  .description('List supported services for a provider')
  .action(async (providerArg: string) => {
    try {
      const provider = await createProvider(providerArg, {}, new ConsoleLogger());
      const services = Object.keys(provider.getSupportedServices()).sort();
      console.log(chalk.blue(`\nSupported ${provider.getName()} services (${services.length}):\n`));
      services.forEach(service => {
        const global = provider.isGlobalService(service) ? chalk.gray(' (global)') : '';
        console.log(`  - ${service}${global}`);
      });
      console.log();
    } catch (error) {
      console.error(chalk.red('Failed to list services:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Interactive Command
program
  .command('interactive')
  .description('Interactive mode for resource selection')
  .action(async () => {
    try {
      const { provider: providerName } = await inquirer.prompt([{
        type: 'list',
        name: 'provider',
        message: 'Select cloud provider:',
        choices: [...SUPPORTED_PROVIDERS]
      }]);
      const listing = await createProvider(providerName, {}, new ConsoleLogger());
      const services = Object.keys(listing.getSupportedServices()).sort();

      const answers = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'resources',
          message: 'Select services to import:',
          choices: services,
          validate: (selected: string[]) => selected.length > 0 || 'Select at least one service'
        },
        {
          type: 'input',
          name: 'scope',
          message: providerName === 'aws' ? 'AWS region(s), comma-separated:'
            : providerName === 'azure' ? 'Azure subscription ID (empty = from environment):'
              : 'GCP project ID(s), comma-separated (empty = from environment):',
          default: providerName === 'aws' ? (process.env.AWS_REGION || 'us-east-1') : ''
        },
        {
          type: 'input',
          name: 'output',
          message: 'Output directory:',
          default: 'generated'
        }
      ]);

      const scope = answers.scope.trim() || undefined;
      await runImport(providerName, {
        resources: answers.resources.join(','),
        output: answers.output,
        filter: [],
        sort: true,
        generate: true,
        terraformBin: 'terraform',
        region: providerName === 'aws' ? scope : undefined,
        subscription: providerName === 'azure' ? scope : undefined,
        projects: providerName === 'google' ? scope : undefined
      });
    } catch (error) {
      console.error(chalk.red('Interactive mode failed:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program.on('command:*', () => {
  console.error(chalk.red('Invalid command. See --help for available commands.'));
  process.exit(1);
});

function readVersion(): string {
  try {
    const packageJson = path.join(__dirname, '..', '..', 'package.json');
    return JSON.parse(fs.readFileSync(packageJson, 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

program.parse();
