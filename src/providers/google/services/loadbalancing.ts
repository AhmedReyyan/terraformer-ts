import { AssetRule, GoogleAsset, GoogleService } from '../google-service';
import { isKubernetesManaged } from './compute';

const C = 'compute.googleapis.com';

/**
 * Load balancer components. The search API returns global and regional variants
 * under one asset type; the path decides the Terraform type.
 */
export class LoadBalancingService extends GoogleService {
  protected readonly rules: AssetRule[] = [
    { assetType: `${C}/ForwardingRule`, path: 'projects/*/global/forwardingRules/*', type: 'google_compute_global_forwarding_rule' },
    { assetType: `${C}/ForwardingRule`, path: 'projects/*/regions/*/forwardingRules/*', type: 'google_compute_forwarding_rule' },
    { assetType: `${C}/BackendService`, path: 'projects/*/global/backendServices/*', type: 'google_compute_backend_service' },
    { assetType: `${C}/BackendService`, path: 'projects/*/regions/*/backendServices/*', type: 'google_compute_region_backend_service' },
    { assetType: `${C}/BackendBucket`, path: 'projects/*/global/backendBuckets/*', type: 'google_compute_backend_bucket' },
    { assetType: `${C}/HealthCheck`, path: 'projects/*/global/healthChecks/*', type: 'google_compute_health_check' },
    { assetType: `${C}/HealthCheck`, path: 'projects/*/regions/*/healthChecks/*', type: 'google_compute_region_health_check' },
    { assetType: `${C}/HttpHealthCheck`, path: 'projects/*/global/httpHealthChecks/*', type: 'google_compute_http_health_check' },
    { assetType: `${C}/HttpsHealthCheck`, path: 'projects/*/global/httpsHealthChecks/*', type: 'google_compute_https_health_check' },
    { assetType: `${C}/UrlMap`, path: 'projects/*/global/urlMaps/*', type: 'google_compute_url_map' },
    { assetType: `${C}/UrlMap`, path: 'projects/*/regions/*/urlMaps/*', type: 'google_compute_region_url_map' },
    { assetType: `${C}/TargetHttpProxy`, path: 'projects/*/global/targetHttpProxies/*', type: 'google_compute_target_http_proxy' },
    { assetType: `${C}/TargetHttpProxy`, path: 'projects/*/regions/*/targetHttpProxies/*', type: 'google_compute_region_target_http_proxy' },
    { assetType: `${C}/TargetHttpsProxy`, path: 'projects/*/global/targetHttpsProxies/*', type: 'google_compute_target_https_proxy' },
    { assetType: `${C}/TargetHttpsProxy`, path: 'projects/*/regions/*/targetHttpsProxies/*', type: 'google_compute_region_target_https_proxy' },
    { assetType: `${C}/TargetTcpProxy`, path: 'projects/*/global/targetTcpProxies/*', type: 'google_compute_target_tcp_proxy' },
    { assetType: `${C}/TargetTcpProxy`, path: 'projects/*/regions/*/targetTcpProxies/*', type: 'google_compute_region_target_tcp_proxy' },
    { assetType: `${C}/TargetSslProxy`, path: 'projects/*/global/targetSslProxies/*', type: 'google_compute_target_ssl_proxy' },
    { assetType: `${C}/TargetGrpcProxy`, path: 'projects/*/global/targetGrpcProxies/*', type: 'google_compute_target_grpc_proxy' },
    { assetType: `${C}/TargetPool`, path: 'projects/*/regions/*/targetPools/*', type: 'google_compute_target_pool' },
    { assetType: `${C}/TargetInstance`, path: 'projects/*/zones/*/targetInstances/*', type: 'google_compute_target_instance' },
    // Only Google-managed certificates: the private key of a self-managed one cannot be read back.
    { assetType: `${C}/SslCertificate`, path: 'projects/*/global/sslCertificates/*', type: 'google_compute_managed_ssl_certificate' },
    { assetType: `${C}/SslPolicy`, path: 'projects/*/global/sslPolicies/*', type: 'google_compute_ssl_policy' },
    { assetType: `${C}/SslPolicy`, path: 'projects/*/regions/*/sslPolicies/*', type: 'google_compute_region_ssl_policy' },
    { assetType: `${C}/SecurityPolicy`, path: 'projects/*/global/securityPolicies/*', type: 'google_compute_security_policy' },
    { assetType: `${C}/SecurityPolicy`, path: 'projects/*/regions/*/securityPolicies/*', type: 'google_compute_region_security_policy' },
    { assetType: `${C}/NetworkEndpointGroup`, path: 'projects/*/zones/*/networkEndpointGroups/*', type: 'google_compute_network_endpoint_group' },
    { assetType: `${C}/NetworkEndpointGroup`, path: 'projects/*/regions/*/networkEndpointGroups/*', type: 'google_compute_region_network_endpoint_group' },
    { assetType: `${C}/NetworkEndpointGroup`, path: 'projects/*/global/networkEndpointGroups/*', type: 'google_compute_global_network_endpoint_group' }
  ];

  protected skip(asset: GoogleAsset): string | undefined {
    if (isKubernetesManaged(asset)) {
      return 'created by GKE';
    }
    if (asset.assetType === `${C}/SslCertificate`) {
      const type = String(asset.attributes.type ?? '');
      if (type !== 'MANAGED') {
        // Regional certificates are always self-managed.
        this.warn(`SSL certificate ${asset.path} skipped: it is not reported as Google-managed, and a ` +
          'self-managed certificate cannot be imported because its private key cannot be read back');
        return 'self-managed certificate';
      }
    }
    return undefined;
  }
}
