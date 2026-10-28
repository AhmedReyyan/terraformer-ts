import { mockClient } from 'aws-sdk-client-mock';
import {
  CloudFrontClient,
  ListDistributionsCommand,
  GetMonitoringSubscriptionCommand,
  ListCachePoliciesCommand,
  ListOriginRequestPoliciesCommand,
  ListResponseHeadersPoliciesCommand,
  ListCloudFrontOriginAccessIdentitiesCommand,
  ListOriginAccessControlsCommand,
  ListFunctionsCommand,
  ListKeyGroupsCommand,
  ListPublicKeysCommand,
  ListKeyValueStoresCommand,
  ListRealtimeLogConfigsCommand,
  ListVpcOriginsCommand
} from '@aws-sdk/client-cloudfront';
import { CloudFrontService } from '../cloudfront';
import { createService, importIds, notFound } from './helpers';

const cf = mockClient(CloudFrontClient);

beforeEach(() => {
  cf.reset();
  for (const command of [
    ListDistributionsCommand, ListCachePoliciesCommand, ListOriginRequestPoliciesCommand, ListResponseHeadersPoliciesCommand,
    ListCloudFrontOriginAccessIdentitiesCommand, ListOriginAccessControlsCommand, ListFunctionsCommand, ListKeyGroupsCommand,
    ListPublicKeysCommand, ListKeyValueStoresCommand, ListRealtimeLogConfigsCommand, ListVpcOriginsCommand
  ]) {
    cf.on(command as any).resolves({});
  }
  cf.on(GetMonitoringSubscriptionCommand).rejects(notFound('NoSuchMonitoringSubscription'));
});

/** Minimal distribution summary; the SDK type requires many fields the service does not read. */
function distribution(id: string, extra: Record<string, unknown> = {}): any {
  return { Id: id, ARN: `arn:aws:cloudfront::111111111111:distribution/${id}`, DomainName: `${id}.cloudfront.net`, Comment: '', ...extra };
}

describe('CloudFrontService', () => {
  it('is global and calls the API in us-east-1', async () => {
    expect(CloudFrontService.global).toBe(true);
    const service = createService(CloudFrontService, 'cloudfront', 'eu-west-1');
    await service.initResources();
    const config = cf.call(0).thisValue as CloudFrontClient;
    expect(await config.config.region()).toBe('us-east-1');
  });

  it('imports distributions over several pages with their monitoring subscriptions', async () => {
    cf.on(ListDistributionsCommand).resolvesOnce({
      DistributionList: { Items: [distribution('E1', { Aliases: { Quantity: 1, Items: ['www.example.com'] } })], IsTruncated: true, NextMarker: 'E1', Marker: '', MaxItems: 1, Quantity: 1 }
    }).resolvesOnce({
      DistributionList: { Items: [distribution('E2'), distribution('E3', { ConnectionMode: 'tenant-only' })], IsTruncated: false, Marker: 'E1', MaxItems: 1, Quantity: 2 }
    });
    cf.on(GetMonitoringSubscriptionCommand, { DistributionId: 'E2' }).resolves({
      MonitoringSubscription: { RealtimeMetricsSubscriptionConfig: { RealtimeMetricsSubscriptionStatus: 'Enabled' } }
    });

    const service = createService(CloudFrontService, 'cloudfront');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_cloudfront_distribution:E1',
      'aws_cloudfront_distribution:E2',
      'aws_cloudfront_monitoring_subscription:E2',
      'aws_cloudfront_multitenant_distribution:E3'
    ]);
    expect(cf.commandCalls(ListDistributionsCommand)[1].args[0].input).toMatchObject({ Marker: 'E1' });
    expect(cf.commandCalls(GetMonitoringSubscriptionCommand, { DistributionId: 'E3' })).toHaveLength(0);
    expect(service.getWarnings()).toEqual([]);
  });

  it('imports only custom policies, following NextMarker', async () => {
    cf.on(ListCachePoliciesCommand).resolvesOnce({
      CachePolicyList: { Items: [{ Type: 'custom', CachePolicy: { Id: 'cp-1', CachePolicyConfig: { Name: 'api' } as any, LastModifiedTime: new Date() } }], NextMarker: 'next', MaxItems: 1, Quantity: 1 }
    }).resolvesOnce({
      CachePolicyList: { Items: [{ Type: 'custom', CachePolicy: { Id: 'cp-2', CachePolicyConfig: { Name: 'static' } as any, LastModifiedTime: new Date() } }], MaxItems: 1, Quantity: 1 }
    });
    cf.on(ListOriginRequestPoliciesCommand).resolves({
      OriginRequestPolicyList: { Items: [{ Type: 'custom', OriginRequestPolicy: { Id: 'orp-1', OriginRequestPolicyConfig: { Name: 'all' } as any, LastModifiedTime: new Date() } }], MaxItems: 1, Quantity: 1 }
    });
    cf.on(ListResponseHeadersPoliciesCommand).resolves({
      ResponseHeadersPolicyList: { Items: [{ Type: 'custom', ResponseHeadersPolicy: { Id: 'rhp-1', ResponseHeadersPolicyConfig: { Name: 'cors' }, LastModifiedTime: new Date() } }], MaxItems: 1, Quantity: 1 }
    });

    const service = createService(CloudFrontService, 'cloudfront');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_cloudfront_cache_policy:cp-1',
      'aws_cloudfront_cache_policy:cp-2',
      'aws_cloudfront_origin_request_policy:orp-1',
      'aws_cloudfront_response_headers_policy:rhp-1'
    ]);
    for (const command of [ListCachePoliciesCommand, ListOriginRequestPoliciesCommand, ListResponseHeadersPoliciesCommand]) {
      expect(cf.commandCalls(command as any)[0].args[0].input).toMatchObject({ Type: 'custom' });
    }
    expect(cf.commandCalls(ListCachePoliciesCommand)[1].args[0].input).toMatchObject({ Marker: 'next' });
  });

  it('imports access identities, access controls, functions, keys, stores, log configs and VPC origins', async () => {
    cf.on(ListCloudFrontOriginAccessIdentitiesCommand).resolves({
      CloudFrontOriginAccessIdentityList: { Items: [{ Id: 'EOAI1', S3CanonicalUserId: 'x', Comment: 'site' }], IsTruncated: false, Marker: '', MaxItems: 1, Quantity: 1 }
    });
    cf.on(ListOriginAccessControlsCommand).resolves({
      OriginAccessControlList: { Items: [{ Id: 'EOAC1', Name: 's3', Description: '', SigningProtocol: 'sigv4', SigningBehavior: 'always', OriginAccessControlOriginType: 's3' }], IsTruncated: false, Marker: '', MaxItems: 1, Quantity: 1 }
    });
    cf.on(ListFunctionsCommand).resolves({
      FunctionList: { Items: [{ Name: 'rewrite', FunctionConfig: { Comment: '', Runtime: 'cloudfront-js-2.0' }, FunctionMetadata: { FunctionARN: 'arn:fn', Stage: 'DEVELOPMENT', LastModifiedTime: new Date() } }], MaxItems: 1, Quantity: 1 }
    });
    cf.on(ListKeyGroupsCommand).resolves({
      KeyGroupList: { Items: [{ KeyGroup: { Id: 'kg-1', KeyGroupConfig: { Name: 'signers', Items: ['K1'] }, LastModifiedTime: new Date() } }], MaxItems: 1, Quantity: 1 }
    });
    cf.on(ListPublicKeysCommand).resolves({
      PublicKeyList: { Items: [{ Id: 'K1', Name: 'signer', CreatedTime: new Date(), EncodedKey: 'k' }], MaxItems: 1, Quantity: 1 }
    });
    cf.on(ListKeyValueStoresCommand).resolves({
      KeyValueStoreList: { Items: [{ Name: 'redirects', Id: 'kvs-1', Comment: '', ARN: 'arn:kvs', LastModifiedTime: new Date() }], MaxItems: 1, Quantity: 1 }
    });
    cf.on(ListRealtimeLogConfigsCommand).resolves({
      RealtimeLogConfigs: { Items: [{ ARN: 'arn:aws:cloudfront::111111111111:realtime-log-config/rt', Name: 'rt', SamplingRate: 1, EndPoints: [], Fields: [] }], IsTruncated: false, Marker: '', MaxItems: 1 }
    });
    cf.on(ListVpcOriginsCommand).resolves({
      VpcOriginList: {
        Items: [
          { Id: 'vo_1', Name: 'alb', Status: 'Deployed', Arn: 'arn:vo1', CreatedTime: new Date(), LastModifiedTime: new Date(), OriginEndpointArn: 'arn:alb' },
          { Id: 'vo_2', Name: 'gone', Status: 'Deleting', Arn: 'arn:vo2', CreatedTime: new Date(), LastModifiedTime: new Date(), OriginEndpointArn: 'arn:alb2' }
        ],
        IsTruncated: false, Marker: '', MaxItems: 2, Quantity: 2
      }
    });

    const service = createService(CloudFrontService, 'cloudfront');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_cloudfront_function:rewrite',
      'aws_cloudfront_key_group:kg-1',
      'aws_cloudfront_key_value_store:redirects',
      'aws_cloudfront_origin_access_control:EOAC1',
      'aws_cloudfront_origin_access_identity:EOAI1',
      'aws_cloudfront_public_key:K1',
      'aws_cloudfront_realtime_log_config:arn:aws:cloudfront::111111111111:realtime-log-config/rt',
      'aws_cloudfront_vpc_origin:vo_1'
    ]);
    expect(cf.commandCalls(ListFunctionsCommand)[0].args[0].input).toMatchObject({ Stage: 'DEVELOPMENT' });
    expect(service.getWarnings()).toEqual([]);
  });
});
