import { mockClient } from 'aws-sdk-client-mock';
import {
  Route53Client,
  ListHostedZonesCommand,
  ListResourceRecordSetsCommand,
  ListHealthChecksCommand,
  ListReusableDelegationSetsCommand,
  ListQueryLoggingConfigsCommand
} from '@aws-sdk/client-route-53';
import { Route53Service, decodeRecordName } from '../route53';
import { createService, importIds } from './helpers';

const route53 = mockClient(Route53Client);

beforeEach(() => {
  route53.reset();
  route53.on(ListHostedZonesCommand).resolves({ HostedZones: [] });
  route53.on(ListResourceRecordSetsCommand).resolves({ ResourceRecordSets: [] });
  route53.on(ListHealthChecksCommand).resolves({ HealthChecks: [] });
  route53.on(ListReusableDelegationSetsCommand).resolves({ DelegationSets: [] });
  route53.on(ListQueryLoggingConfigsCommand).resolves({ QueryLoggingConfigs: [] });
});

describe('decodeRecordName', () => {
  it('decodes octal escapes and strips the trailing dot', () => {
    expect(decodeRecordName('\\052.example.com.')).toBe('*.example.com');
    expect(decodeRecordName('a\\100b.example.com.')).toBe('a@b.example.com');
    expect(decodeRecordName('example.com')).toBe('example.com');
  });
});

describe('Route53Service', () => {
  it('is global', () => {
    expect(Route53Service.global).toBe(true);
  });

  it('imports zones and records with paginated listings and skips apex NS/SOA and linked zones', async () => {
    route53.on(ListHostedZonesCommand).resolvesOnce({
      HostedZones: [{ Id: '/hostedzone/ZPUBLIC', Name: 'example.com.', CallerReference: 'a', Config: { PrivateZone: false } }],
      IsTruncated: true, NextMarker: 'm1', Marker: '', MaxItems: 1
    }).resolvesOnce({
      HostedZones: [
        { Id: '/hostedzone/ZPRIVATE', Name: 'internal.local.', CallerReference: 'b', Config: { PrivateZone: true } },
        { Id: '/hostedzone/ZCLOUDMAP', Name: 'svc.local.', CallerReference: 'c', LinkedService: { ServicePrincipal: 'servicediscovery.amazonaws.com' } }
      ],
      IsTruncated: false, Marker: 'm1', MaxItems: 1
    });
    route53.on(ListResourceRecordSetsCommand, { HostedZoneId: 'ZPUBLIC' }).resolvesOnce({
      ResourceRecordSets: [
        { Name: 'example.com.', Type: 'NS', TTL: 172800, ResourceRecords: [{ Value: 'ns-1.awsdns-1.com.' }] },
        { Name: 'example.com.', Type: 'SOA', TTL: 900, ResourceRecords: [{ Value: 'soa' }] },
        { Name: 'example.com.', Type: 'A', AliasTarget: { DNSName: 'd.cloudfront.net.', HostedZoneId: 'Z2FDTNDATAQYW2', EvaluateTargetHealth: false } },
        { Name: '\\052.example.com.', Type: 'CNAME', TTL: 300, ResourceRecords: [{ Value: 'example.com' }] }
      ],
      IsTruncated: true, NextRecordName: 'sub.example.com.', NextRecordType: 'NS', MaxItems: 4
    }).resolvesOnce({
      ResourceRecordSets: [
        { Name: 'sub.example.com.', Type: 'NS', TTL: 300, ResourceRecords: [{ Value: 'ns.other.com.' }] },
        { Name: 'www.example.com.', Type: 'A', SetIdentifier: 'eu', Region: 'eu-west-1', TTL: 60, ResourceRecords: [{ Value: '1.2.3.4' }] },
        { Name: 'www.example.com.', Type: 'A', SetIdentifier: 'us_east', Region: 'us-east-1', TTL: 60, ResourceRecords: [{ Value: '1.2.3.5' }] }
      ],
      IsTruncated: false, MaxItems: 4
    });
    route53.on(ListResourceRecordSetsCommand, { HostedZoneId: 'ZPRIVATE' }).resolves({
      ResourceRecordSets: [
        { Name: 'internal.local.', Type: 'SOA', TTL: 900, ResourceRecords: [{ Value: 'soa' }] },
        { Name: '_db.internal.local.', Type: 'TXT', TTL: 60, ResourceRecords: [{ Value: '"x"' }] }
      ],
      IsTruncated: false, MaxItems: 100
    });

    const service = createService(Route53Service, 'route53');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_route53_record:ZPRIVATE__db.internal.local_TXT',
      'aws_route53_record:ZPUBLIC_*.example.com_CNAME',
      'aws_route53_record:ZPUBLIC_example.com_A',
      'aws_route53_record:ZPUBLIC_sub.example.com_NS',
      'aws_route53_record:ZPUBLIC_www.example.com_A_eu',
      'aws_route53_zone:ZPRIVATE',
      'aws_route53_zone:ZPUBLIC'
    ]);
    expect(route53.commandCalls(ListHostedZonesCommand)[1].args[0].input).toMatchObject({ Marker: 'm1' });
    expect(route53.commandCalls(ListResourceRecordSetsCommand, { HostedZoneId: 'ZPUBLIC' })[1].args[0].input).toMatchObject({
      StartRecordName: 'sub.example.com.', StartRecordType: 'NS'
    });
    expect(route53.commandCalls(ListResourceRecordSetsCommand, { HostedZoneId: 'ZCLOUDMAP' })).toHaveLength(0);
    // The record whose set identifier contains "_" cannot be imported and is reported.
    expect(service.getWarnings()).toHaveLength(1);
    expect(service.getWarnings()[0]).toContain('us_east');
  });

  it('imports health checks, delegation sets and query logging configs', async () => {
    route53.on(ListHealthChecksCommand).resolves({
      HealthChecks: [
        { Id: 'hc-1', CallerReference: 'r', HealthCheckVersion: 1, HealthCheckConfig: { Type: 'HTTPS', FullyQualifiedDomainName: 'example.com' } },
        { Id: 'hc-cloudmap', CallerReference: 'r', HealthCheckVersion: 1, HealthCheckConfig: { Type: 'HTTP' }, LinkedService: { ServicePrincipal: 'servicediscovery.amazonaws.com' } }
      ],
      IsTruncated: false, Marker: '', MaxItems: 100
    });
    route53.on(ListReusableDelegationSetsCommand).resolvesOnce({
      DelegationSets: [{ Id: '/delegationset/N1', CallerReference: 'set1', NameServers: [] }],
      IsTruncated: true, NextMarker: 'd2', Marker: '', MaxItems: 1
    }).resolvesOnce({
      DelegationSets: [{ Id: '/delegationset/N2', NameServers: [] }],
      IsTruncated: false, Marker: 'd2', MaxItems: 1
    });
    route53.on(ListQueryLoggingConfigsCommand).resolves({
      QueryLoggingConfigs: [{ Id: 'qlc-1', HostedZoneId: 'ZPUBLIC', CloudWatchLogsLogGroupArn: 'arn:aws:logs:us-east-1:1:log-group:/aws/route53/example.com' }]
    });

    const service = createService(Route53Service, 'route53');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_route53_delegation_set:N1',
      'aws_route53_delegation_set:N2',
      'aws_route53_health_check:hc-1',
      'aws_route53_query_log:qlc-1'
    ]);
    expect(route53.commandCalls(ListReusableDelegationSetsCommand)[1].args[0].input).toMatchObject({ Marker: 'd2' });
    expect(service.getWarnings()).toEqual([]);
  });

  it('records a warning and continues when a listing is denied', async () => {
    route53.on(ListHostedZonesCommand).rejects(Object.assign(new Error('denied'), { name: 'AccessDenied' }));
    route53.on(ListHealthChecksCommand).resolves({
      HealthChecks: [{ Id: 'hc-1', CallerReference: 'r', HealthCheckVersion: 1, HealthCheckConfig: { Type: 'TCP', IPAddress: '1.2.3.4' } }],
      IsTruncated: false, Marker: '', MaxItems: 100
    });

    const service = createService(Route53Service, 'route53');
    await service.initResources();

    expect(importIds(service)).toEqual(['aws_route53_health_check:hc-1']);
    expect(service.getWarnings()[0]).toContain('AccessDenied');
  });
});
