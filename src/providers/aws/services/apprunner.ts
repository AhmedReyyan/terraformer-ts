import {
  AppRunnerClient,
  paginateListServices,
  paginateListAutoScalingConfigurations,
  paginateListObservabilityConfigurations,
  paginateListVpcConnectors,
  paginateListVpcIngressConnections,
  paginateListConnections,
  paginateDescribeCustomDomains,
  ServiceSummary
} from '@aws-sdk/client-apprunner';
import { mapLimit } from '../../../core/provider';
import { AwsService, arnResourceName } from '../aws-service';

/** Services and domain associations in these states are gone or never came up. */
const GONE_STATES = new Set(['DELETED', 'DELETING', 'CREATE_FAILED', 'DELETE_FAILED']);

/** App Runner provides revision 1 of this auto scaling configuration in every account. */
const DEFAULT_AUTO_SCALING_CONFIGURATION = 'DefaultConfiguration';

export class AppRunnerService extends AwsService {
  async initResources(): Promise<void> {
    const apprunner = this.client(AppRunnerClient);
    const services: ServiceSummary[] = [];

    await this.collect('App Runner services', async () => {
      for await (const page of paginateListServices({ client: apprunner }, {})) {
        for (const service of page.ServiceSummaryList || []) {
          if (!service.ServiceArn || GONE_STATES.has(service.Status || '')) {
            continue;
          }
          services.push(service);
          this.add('aws_apprunner_service', service.ServiceArn, service.ServiceName || service.ServiceArn, {
            service_name: service.ServiceName,
            arn: service.ServiceArn,
            service_url: service.ServiceUrl
          });
        }
      }
    });

    await mapLimit(services, 5, service => this.collect(`App Runner custom domains of ${service.ServiceName}`, async () => {
      for await (const page of paginateDescribeCustomDomains({ client: apprunner }, { ServiceArn: service.ServiceArn })) {
        for (const domain of page.CustomDomains || []) {
          if (!domain.DomainName || GONE_STATES.has(domain.Status || '')) {
            continue;
          }
          this.add('aws_apprunner_custom_domain_association', `${domain.DomainName},${service.ServiceArn}`, domain.DomainName, {
            domain_name: domain.DomainName,
            service_arn: service.ServiceArn
          });
        }
      }
    }));

    // Configurations are versioned; only the latest active revision of each name is imported.
    await this.collect('App Runner auto scaling configurations', async () => {
      for await (const page of paginateListAutoScalingConfigurations({ client: apprunner }, { LatestOnly: true })) {
        for (const config of page.AutoScalingConfigurationSummaryList || []) {
          const name = config.AutoScalingConfigurationName;
          if (!config.AutoScalingConfigurationArn || !name || config.Status === 'INACTIVE' ||
            (name === DEFAULT_AUTO_SCALING_CONFIGURATION && config.AutoScalingConfigurationRevision === 1)) {
            continue;
          }
          this.add('aws_apprunner_auto_scaling_configuration_version', config.AutoScalingConfigurationArn, name, {
            name,
            revision: config.AutoScalingConfigurationRevision,
            arn: config.AutoScalingConfigurationArn
          });
        }
      }
    });

    await this.collect('App Runner observability configurations', async () => {
      for await (const page of paginateListObservabilityConfigurations({ client: apprunner }, { LatestOnly: true })) {
        for (const config of page.ObservabilityConfigurationSummaryList || []) {
          if (config.ObservabilityConfigurationArn && config.ObservabilityConfigurationName) {
            this.add('aws_apprunner_observability_configuration', config.ObservabilityConfigurationArn,
              config.ObservabilityConfigurationName, {
                name: config.ObservabilityConfigurationName,
                revision: config.ObservabilityConfigurationRevision,
                arn: config.ObservabilityConfigurationArn
              });
          }
        }
      }
    });

    await this.collect('App Runner VPC connectors', async () => {
      for await (const page of paginateListVpcConnectors({ client: apprunner }, {})) {
        for (const connector of page.VpcConnectors || []) {
          // Every ACTIVE revision is a separate connector that services may reference; INACTIVE ones are deleted.
          if (!connector.VpcConnectorArn || connector.Status !== 'ACTIVE') {
            continue;
          }
          this.add('aws_apprunner_vpc_connector', connector.VpcConnectorArn, connector.VpcConnectorName || connector.VpcConnectorArn, {
            name: connector.VpcConnectorName,
            revision: connector.VpcConnectorRevision,
            arn: connector.VpcConnectorArn
          });
        }
      }
    });

    await this.collect('App Runner VPC ingress connections', async () => {
      for await (const page of paginateListVpcIngressConnections({ client: apprunner }, {})) {
        for (const connection of page.VpcIngressConnectionSummaryList || []) {
          if (connection.VpcIngressConnectionArn) {
            const name = connection.VpcIngressConnectionArn.split('/')[1] || arnResourceName(connection.VpcIngressConnectionArn);
            this.add('aws_apprunner_vpc_ingress_connection', connection.VpcIngressConnectionArn, name, {
              arn: connection.VpcIngressConnectionArn,
              service_arn: connection.ServiceArn
            });
          }
        }
      }
    });

    await this.collect('App Runner connections', async () => {
      for await (const page of paginateListConnections({ client: apprunner }, {})) {
        for (const connection of page.ConnectionSummaryList || []) {
          if (!connection.ConnectionName || connection.Status === 'DELETED') {
            continue;
          }
          this.add('aws_apprunner_connection', connection.ConnectionName, connection.ConnectionName, {
            connection_name: connection.ConnectionName,
            arn: connection.ConnectionArn,
            provider_type: connection.ProviderType
          });
        }
      }
    });
  }
}
