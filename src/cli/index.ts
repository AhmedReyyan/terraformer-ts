#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { AWSProvider } from '../providers/aws/aws-provider';
import { Terraformer } from '../core/terraformer';
import { ConsoleLogger } from '../core/logger';
import { ImportOptions, ProviderConfig } from '../types';

const program = new Command();

program
  .name('terraformer')
  .description('Generate Terraform configurations from existing cloud infrastructure')
  .version('1.0.0');

// AWS Provider Command
program
  .command('aws')
  .description('Import AWS resources')
  .option('-r, --resources <resources>', 'Comma-separated list of resources to import', 'ec2,s3')
  .option('-x, --excludes <excludes>', 'Comma-separated list of resources to exclude')
  .option('-o, --output <path>', 'Output directory', 'generated')
  .option('-p, --path-pattern <pattern>', 'Path pattern for output files', '{output}/{provider}/{service}/')
  .option('--region <region>', 'AWS region', 'us-east-1')
  .option('--profile <profile>', 'AWS profile', 'default')
  .option('-f, --filters <filters>', 'Comma-separated list of filters')
  .option('--compact', 'Generate compact output files')
  .option('--json', 'Generate JSON output instead of HCL')
  .option('-v, --verbose', 'Verbose output')
  .option('--no-sort', 'Don\'t sort resources')
  .action(async (options) => {
    try {
      const logger = new ConsoleLogger(options.verbose);
      const config: ProviderConfig = {
        region: options.region,
        profile: options.profile
      };

      const provider = new AWSProvider(config, logger);
      const terraformer = new Terraformer(provider, logger);

      const importOptions: ImportOptions = {
        resources: options.resources.split(','),
        excludes: options.excludes?.split(','),
        pathOutput: options.output,
        pathPattern: options.pathPattern,
        region: options.region,
        profile: options.profile,
        filters: options.filters?.split(','),
        compact: options.compact,
        output: options.json ? 'json' : 'hcl',
        verbose: options.verbose,
        noSort: options.noSort
      };

      const spinner = ora('Importing AWS resources...').start();

      await terraformer.import(importOptions, (message: string, current: number, total: number) => {
        spinner.text = `${message} (${current}/${total})`;
      });

      spinner.succeed(chalk.green('Import completed successfully!'));
      
      console.log(chalk.blue(`\nGenerated files in: ${options.output}`));
      console.log(chalk.gray('You can now run:'));
      console.log(chalk.gray(`  cd ${options.output}`));
      console.log(chalk.gray('  terraform init'));
      console.log(chalk.gray('  terraform plan'));

    } catch (error) {
      console.error(chalk.red('Import failed:'), error);
      process.exit(1);
    }
  });

// Plan Command
program
  .command('plan <provider>')
  .description('Generate import plan')
  .option('-r, --resources <resources>', 'Comma-separated list of resources to import', 'ec2,s3')
  .option('-o, --output <path>', 'Output directory', 'generated')
  .option('--region <region>', 'AWS region', 'us-east-1')
  .option('--profile <profile>', 'AWS profile', 'default')
  .option('-v, --verbose', 'Verbose output')
  .action(async (provider, options) => {
    try {
      const logger = new ConsoleLogger(options.verbose);
      
      if (provider === 'aws') {
        const config: ProviderConfig = {
          region: options.region,
          profile: options.profile
        };

        const awsProvider = new AWSProvider(config, logger);
        const terraformer = new Terraformer(awsProvider, logger);

        const importOptions: ImportOptions = {
          resources: options.resources.split(','),
          pathOutput: options.output,
          region: options.region,
          profile: options.profile,
          verbose: options.verbose
        };

        await terraformer.plan(importOptions);
        console.log(chalk.green('Plan generated successfully!'));
      } else {
        console.error(chalk.red(`Unsupported provider: ${provider}`));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red('Plan generation failed:'), error);
      process.exit(1);
    }
  });

// List Command
program
  .command('list <provider>')
  .description('List supported resources for a provider')
  .action(async (provider) => {
    try {
      const logger = new ConsoleLogger();
      
      if (provider === 'aws') {
        const config: ProviderConfig = { region: 'us-east-1' };
        const awsProvider = new AWSProvider(config, logger);
        const terraformer = new Terraformer(awsProvider, logger);
        
        const services = terraformer.getSupportedServices();
        
        console.log(chalk.blue(`\nSupported AWS services:\n`));
        services.forEach((service: string) => {
          console.log(chalk.gray(`  - ${service}`));
        });
        console.log();
      } else {
        console.error(chalk.red(`Unsupported provider: ${provider}`));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red('Failed to list resources:'), error);
      process.exit(1);
    }
  });

// Interactive Command
program
  .command('interactive')
  .description('Interactive mode for resource selection')
  .action(async () => {
    try {
      const answers = await inquirer.prompt([
        {
          type: 'list',
          name: 'provider',
          message: 'Select cloud provider:',
          choices: ['aws', 'gcp', 'azure']
        },
        {
          type: 'checkbox',
          name: 'resources',
          message: 'Select resources to import:',
          choices: [
            { name: 'EC2 Instances', value: 'ec2' },
            { name: 'S3 Buckets', value: 's3' },
            { name: 'RDS Databases', value: 'rds' },
            { name: 'Lambda Functions', value: 'lambda' },
            { name: 'VPCs', value: 'vpc' },
            { name: 'Security Groups', value: 'sg' }
          ]
        },
        {
          type: 'input',
          name: 'region',
          message: 'Enter region:',
          default: 'us-east-1'
        },
        {
          type: 'input',
          name: 'output',
          message: 'Enter output directory:',
          default: 'generated'
        }
      ]);

      console.log(chalk.blue('\nStarting import with selected options...'));
      
      const logger = new ConsoleLogger(true);
      const config: ProviderConfig = {
        region: answers.region
      };

      const provider = new AWSProvider(config, logger);
      const terraformer = new Terraformer(provider, logger);

      const importOptions: ImportOptions = {
        resources: answers.resources,
        pathOutput: answers.output,
        region: answers.region,
        verbose: true
      };

      const spinner = ora('Importing resources...').start();

      await terraformer.import(importOptions, (message: string, current: number, total: number) => {
        spinner.text = `${message} (${current}/${total})`;
      });

      spinner.succeed(chalk.green('Import completed successfully!'));
      
    } catch (error) {
      console.error(chalk.red('Interactive mode failed:'), error);
      process.exit(1);
    }
  });

// Error handling
program.on('command:*', () => {
  console.error(chalk.red('Invalid command. See --help for available commands.'));
  process.exit(1);
});

// Parse command line arguments
program.parse();
