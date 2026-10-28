import { mockClient } from 'aws-sdk-client-mock';
import {
  AppRunnerClient,
  ListServicesCommand,
  ListAutoScalingConfigurationsCommand,
  ListObservabilityConfigurationsCommand,
  ListVpcConnectorsCommand,
  ListVpcIngressConnectionsCommand,
  ListConnectionsCommand,
  DescribeCustomDomainsCommand
} from '@aws-sdk/client-apprunner';
import { AppRunnerService } from '../apprunner';
import { createService, importIds } from './helpers';

const apprunner = mockClient(AppRunnerClient);
const arn = (path: string) => `arn:aws:apprunner:us-east-1:123456789012:${path}`;
const SERVICE = arn('service/web/abc');

beforeEach(() => {
  apprunner.reset();
  apprunner.on(DescribeCustomDomainsCommand).resolves({ CustomDomains: [], DNSTarget: '', ServiceArn: '', VpcDNSTargets: [] });
  apprunner.on(ListAutoScalingConfigurationsCommand).resolves({ AutoScalingConfigurationSummaryList: [] });
  apprunner.on(ListObservabilityConfigurationsCommand).resolves({ ObservabilityConfigurationSummaryList: [] });
  apprunner.on(ListVpcConnectorsCommand).resolves({ VpcConnectors: [] });
  apprunner.on(ListVpcIngressConnectionsCommand).resolves({ VpcIngressConnectionSummaryList: [] });
  apprunner.on(ListConnectionsCommand).resolves({ ConnectionSummaryList: [] });
});

describe('AppRunnerService', () => {
  it('imports services and their configurations, skipping deleted objects and the AWS default', async () => {
    apprunner.on(ListServicesCommand)
      .resolvesOnce({ ServiceSummaryList: [{ ServiceName: 'web', ServiceArn: SERVICE, Status: 'RUNNING' }], NextToken: 'n1' })
      .resolvesOnce({ ServiceSummaryList: [{ ServiceName: 'old', ServiceArn: arn('service/old/def'), Status: 'DELETED' }] });
    apprunner.on(DescribeCustomDomainsCommand, { ServiceArn: SERVICE }).resolves({
      DNSTarget: '', ServiceArn: SERVICE, VpcDNSTargets: [],
      CustomDomains: [
        { DomainName: 'example.com', EnableWWWSubdomain: true, Status: 'ACTIVE' },
        { DomainName: 'old.example.com', EnableWWWSubdomain: false, Status: 'DELETING' }
      ]
    });
    apprunner.on(ListAutoScalingConfigurationsCommand).resolves({
      AutoScalingConfigurationSummaryList: [
        { AutoScalingConfigurationName: 'DefaultConfiguration', AutoScalingConfigurationRevision: 1, Status: 'ACTIVE', AutoScalingConfigurationArn: arn('autoscalingconfiguration/DefaultConfiguration/1/x') },
        { AutoScalingConfigurationName: 'burst', AutoScalingConfigurationRevision: 2, Status: 'ACTIVE', AutoScalingConfigurationArn: arn('autoscalingconfiguration/burst/2/y') }
      ]
    });
    apprunner.on(ListObservabilityConfigurationsCommand).resolves({
      ObservabilityConfigurationSummaryList: [{ ObservabilityConfigurationName: 'xray', ObservabilityConfigurationArn: arn('observabilityconfiguration/xray/1/z') }]
    });
    apprunner.on(ListVpcConnectorsCommand).resolves({
      VpcConnectors: [
        { VpcConnectorName: 'vpc', VpcConnectorArn: arn('vpcconnector/vpc/1/a'), Status: 'ACTIVE' },
        { VpcConnectorName: 'vpc-old', VpcConnectorArn: arn('vpcconnector/vpc-old/1/b'), Status: 'INACTIVE' }
      ]
    });
    apprunner.on(ListVpcIngressConnectionsCommand).resolves({
      VpcIngressConnectionSummaryList: [{ VpcIngressConnectionArn: arn('vpcingressconnection/private/c'), ServiceArn: SERVICE }]
    });
    apprunner.on(ListConnectionsCommand).resolves({
      ConnectionSummaryList: [
        { ConnectionName: 'github', Status: 'AVAILABLE' },
        { ConnectionName: 'removed', Status: 'DELETED' }
      ]
    });

    const service = createService(AppRunnerService, 'apprunner');
    await service.initResources();

    expect(importIds(service)).toEqual([
      `aws_apprunner_auto_scaling_configuration_version:${arn('autoscalingconfiguration/burst/2/y')}`,
      'aws_apprunner_connection:github',
      `aws_apprunner_custom_domain_association:example.com,${SERVICE}`,
      `aws_apprunner_observability_configuration:${arn('observabilityconfiguration/xray/1/z')}`,
      `aws_apprunner_service:${SERVICE}`,
      `aws_apprunner_vpc_connector:${arn('vpcconnector/vpc/1/a')}`,
      `aws_apprunner_vpc_ingress_connection:${arn('vpcingressconnection/private/c')}`
    ]);
    expect(apprunner.commandCalls(ListAutoScalingConfigurationsCommand)[0].args[0].input).toMatchObject({ LatestOnly: true });
    expect(service.getWarnings()).toEqual([]);
  });
});
