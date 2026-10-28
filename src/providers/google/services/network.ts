import { AssetRule, GoogleAsset, GoogleService, lastSegment } from '../google-service';
import { isKubernetesManaged } from './compute';

const C = 'compute.googleapis.com';

/**
 * VPC networks, subnets, firewalls, routes, Cloud Routers and VPN.
 * Router NATs, interfaces and BGP peers are separate Terraform resources that the
 * asset search does not list, so they are not imported.
 */
export class NetworkService extends GoogleService {
  protected readonly rules: AssetRule[] = [
    { assetType: `${C}/Network`, path: 'projects/*/global/networks/*', type: 'google_compute_network' },
    { assetType: `${C}/Subnetwork`, path: 'projects/*/regions/*/subnetworks/*', type: 'google_compute_subnetwork' },
    { assetType: `${C}/Firewall`, path: 'projects/*/global/firewalls/*', type: 'google_compute_firewall' },
    { assetType: `${C}/Route`, path: 'projects/*/global/routes/*', type: 'google_compute_route' },
    { assetType: `${C}/Router`, path: 'projects/*/regions/*/routers/*', type: 'google_compute_router' },
    // HA VPN gateways are `vpnGateways`, classic VPN gateways are `targetVpnGateways`.
    { assetType: `${C}/VpnGateway`, path: 'projects/*/regions/*/vpnGateways/*', type: 'google_compute_ha_vpn_gateway' },
    { assetType: `${C}/TargetVpnGateway`, path: 'projects/*/regions/*/targetVpnGateways/*', type: 'google_compute_vpn_gateway' },
    { assetType: `${C}/ExternalVpnGateway`, path: 'projects/*/global/externalVpnGateways/*', type: 'google_compute_external_vpn_gateway' },
    { assetType: `${C}/VpnTunnel`, path: 'projects/*/regions/*/vpnTunnels/*', type: 'google_compute_vpn_tunnel' },
    { assetType: `${C}/InterconnectAttachment`, path: 'projects/*/regions/*/interconnectAttachments/*', type: 'google_compute_interconnect_attachment' },
    { assetType: `${C}/NetworkAttachment`, path: 'projects/*/regions/*/networkAttachments/*', type: 'google_compute_network_attachment' },
    { assetType: `${C}/ServiceAttachment`, path: 'projects/*/regions/*/serviceAttachments/*', type: 'google_compute_service_attachment' },
    { assetType: `${C}/PacketMirroring`, path: 'projects/*/regions/*/packetMirrorings/*', type: 'google_compute_packet_mirroring' }
  ];

  protected skip(asset: GoogleAsset): string | undefined {
    const name = lastSegment(asset.path);
    switch (asset.assetType) {
      case `${C}/Route`:
        // Subnet routes, the default internet route and peering routes are created by Google.
        if (name.startsWith('default-route-') || name.startsWith('peering-route-')) {
          return 'created automatically by the network';
        }
        return name.startsWith('gke-') ? 'created by GKE' : undefined;
      case `${C}/Firewall`:
        return name.startsWith('gke-') || isKubernetesManaged(asset) ? 'created by GKE' : undefined;
    }
    return undefined;
  }
}
