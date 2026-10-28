import {
  CloudFrontClient,
  paginateListDistributions,
  paginateListCloudFrontOriginAccessIdentities,
  paginateListOriginAccessControls,
  paginateListPublicKeys,
  paginateListKeyValueStores,
  ListCachePoliciesCommand,
  ListOriginRequestPoliciesCommand,
  ListResponseHeadersPoliciesCommand,
  ListFunctionsCommand,
  ListKeyGroupsCommand,
  ListRealtimeLogConfigsCommand,
  ListVpcOriginsCommand,
  GetMonitoringSubscriptionCommand
} from '@aws-sdk/client-cloudfront';
import { mapLimit } from '../../../core/provider';
import { AwsService, optional } from '../aws-service';

/** Call a Marker/NextMarker paginated CloudFront list operation until the last page. */
async function eachPage<T>(fetch: (marker: string | undefined) => Promise<{ items?: T[]; next?: string }>, fn: (item: T) => void): Promise<void> {
  let marker: string | undefined;
  do {
    const page = await fetch(marker);
    (page.items || []).forEach(fn);
    marker = page.next || undefined;
  } while (marker);
}

export class CloudFrontService extends AwsService {
  static readonly global = true;

  async initResources(): Promise<void> {
    // The CloudFront API is only served from us-east-1.
    const cf = this.client(CloudFrontClient, 'us-east-1');
    const directDistributions: string[] = [];

    await this.collect('CloudFront distributions', async () => {
      for await (const page of paginateListDistributions({ client: cf }, {})) {
        for (const d of page.DistributionList?.Items || []) {
          const name = d.Aliases?.Items?.[0] || d.Comment || d.Id!;
          const attributes = { id: d.Id, arn: d.ARN, domain_name: d.DomainName, aliases: d.Aliases?.Items || [] };
          if (d.ConnectionMode === 'tenant-only') {
            this.add('aws_cloudfront_multitenant_distribution', d.Id!, name, attributes);
          } else {
            directDistributions.push(d.Id!);
            this.add('aws_cloudfront_distribution', d.Id!, name, attributes);
          }
        }
      }
    });

    await mapLimit(directDistributions, 5, id =>
      this.collect(`CloudFront monitoring subscription of ${id}`, async () => {
        const response = await optional(cf.send(new GetMonitoringSubscriptionCommand({ DistributionId: id })));
        if (response?.MonitoringSubscription) {
          this.add('aws_cloudfront_monitoring_subscription', id, `${id}_monitoring`, { distribution_id: id });
        }
      })
    );

    // Only custom policies: AWS managed policies (Type=managed) cannot be managed by Terraform.
    await this.collect('CloudFront cache policies', () =>
      eachPage(
        async Marker => {
          const list = (await cf.send(new ListCachePoliciesCommand({ Type: 'custom', Marker }))).CachePolicyList;
          return { items: list?.Items, next: list?.NextMarker };
        },
        item => {
          const policy = item.CachePolicy!;
          const name = policy.CachePolicyConfig?.Name || policy.Id!;
          this.add('aws_cloudfront_cache_policy', policy.Id!, name, { id: policy.Id, name });
        }
      )
    );

    await this.collect('CloudFront origin request policies', () =>
      eachPage(
        async Marker => {
          const list = (await cf.send(new ListOriginRequestPoliciesCommand({ Type: 'custom', Marker }))).OriginRequestPolicyList;
          return { items: list?.Items, next: list?.NextMarker };
        },
        item => {
          const policy = item.OriginRequestPolicy!;
          const name = policy.OriginRequestPolicyConfig?.Name || policy.Id!;
          this.add('aws_cloudfront_origin_request_policy', policy.Id!, name, { id: policy.Id, name });
        }
      )
    );

    await this.collect('CloudFront response headers policies', () =>
      eachPage(
        async Marker => {
          const list = (await cf.send(new ListResponseHeadersPoliciesCommand({ Type: 'custom', Marker }))).ResponseHeadersPolicyList;
          return { items: list?.Items, next: list?.NextMarker };
        },
        item => {
          const policy = item.ResponseHeadersPolicy!;
          const name = policy.ResponseHeadersPolicyConfig?.Name || policy.Id!;
          this.add('aws_cloudfront_response_headers_policy', policy.Id!, name, { id: policy.Id, name });
        }
      )
    );

    await this.collect('CloudFront origin access identities', async () => {
      for await (const page of paginateListCloudFrontOriginAccessIdentities({ client: cf }, {})) {
        for (const oai of page.CloudFrontOriginAccessIdentityList?.Items || []) {
          this.add('aws_cloudfront_origin_access_identity', oai.Id!, oai.Comment || oai.Id!, { id: oai.Id, comment: oai.Comment });
        }
      }
    });

    await this.collect('CloudFront origin access controls', async () => {
      for await (const page of paginateListOriginAccessControls({ client: cf }, {})) {
        for (const oac of page.OriginAccessControlList?.Items || []) {
          this.add('aws_cloudfront_origin_access_control', oac.Id!, oac.Name || oac.Id!, { id: oac.Id, name: oac.Name });
        }
      }
    });

    // Every function has a DEVELOPMENT stage (LIVE only once published), so listing that stage
    // returns each function exactly once. The import ID is the function name.
    await this.collect('CloudFront functions', () =>
      eachPage(
        async Marker => {
          const list = (await cf.send(new ListFunctionsCommand({ Stage: 'DEVELOPMENT', Marker }))).FunctionList;
          return { items: list?.Items, next: list?.NextMarker };
        },
        fn => this.add('aws_cloudfront_function', fn.Name!, fn.Name!, { name: fn.Name, arn: fn.FunctionMetadata?.FunctionARN })
      )
    );

    await this.collect('CloudFront key groups', () =>
      eachPage(
        async Marker => {
          const list = (await cf.send(new ListKeyGroupsCommand({ Marker }))).KeyGroupList;
          return { items: list?.Items, next: list?.NextMarker };
        },
        item => {
          const group = item.KeyGroup!;
          const name = group.KeyGroupConfig?.Name || group.Id!;
          this.add('aws_cloudfront_key_group', group.Id!, name, { id: group.Id, name });
        }
      )
    );

    await this.collect('CloudFront public keys', async () => {
      for await (const page of paginateListPublicKeys({ client: cf }, {})) {
        for (const key of page.PublicKeyList?.Items || []) {
          this.add('aws_cloudfront_public_key', key.Id!, key.Name || key.Id!, { id: key.Id, name: key.Name });
        }
      }
    });

    await this.collect('CloudFront key value stores', async () => {
      for await (const page of paginateListKeyValueStores({ client: cf }, {})) {
        for (const store of page.KeyValueStoreList?.Items || []) {
          this.add('aws_cloudfront_key_value_store', store.Name!, store.Name!, { id: store.Id, name: store.Name, arn: store.ARN });
        }
      }
    });

    await this.collect('CloudFront real-time log configs', () =>
      eachPage(
        async Marker => {
          const list = (await cf.send(new ListRealtimeLogConfigsCommand({ Marker }))).RealtimeLogConfigs;
          return { items: list?.Items, next: list?.IsTruncated ? list.NextMarker : undefined };
        },
        config => this.add('aws_cloudfront_realtime_log_config', config.ARN!, config.Name || config.ARN!, { name: config.Name, arn: config.ARN })
      )
    );

    await this.collect('CloudFront VPC origins', () =>
      eachPage(
        async Marker => {
          const list = (await cf.send(new ListVpcOriginsCommand({ Marker }))).VpcOriginList;
          return { items: list?.Items, next: list?.IsTruncated ? list.NextMarker : undefined };
        },
        origin => {
          // VPC origins being deleted are skipped.
          if (origin.Status === 'Deleting') {
            return;
          }
          this.add('aws_cloudfront_vpc_origin', origin.Id!, origin.Name || origin.Id!, { id: origin.Id, name: origin.Name, arn: origin.Arn });
        }
      )
    );
  }
}
