import { AssetRule, GoogleAsset, GoogleService, OWNER_LABELS, lastSegment, zoneRegion } from '../google-service';

const C = 'compute.googleapis.com';

/**
 * Labels GKE puts on node VMs and persistent-volume disks: those objects are
 * owned by a node pool / the cluster and recreated by it.
 */
const GKE_LABELS = ['goog-gke-node', 'goog-gke-volume', 'goog-k8s-cluster-name'];

/** VMs, disks, images, templates, instance groups and addresses. */
export class ComputeService extends GoogleService {
  protected readonly ownerLabels = [...OWNER_LABELS, ...GKE_LABELS];

  protected readonly rules: AssetRule[] = [
    { assetType: `${C}/Instance`, path: 'projects/*/zones/*/instances/*', type: 'google_compute_instance' },
    { assetType: `${C}/Disk`, path: 'projects/*/zones/*/disks/*', type: 'google_compute_disk' },
    { assetType: `${C}/Disk`, path: 'projects/*/regions/*/disks/*', type: 'google_compute_region_disk' },
    { assetType: `${C}/Image`, path: 'projects/*/global/images/*', type: 'google_compute_image' },
    { assetType: `${C}/MachineImage`, path: 'projects/*/global/machineImages/*', type: 'google_compute_machine_image' },
    { assetType: `${C}/InstanceTemplate`, path: 'projects/*/global/instanceTemplates/*', type: 'google_compute_instance_template' },
    { assetType: `${C}/InstanceTemplate`, path: 'projects/*/regions/*/instanceTemplates/*', type: 'google_compute_region_instance_template' },
    { assetType: `${C}/InstanceGroupManager`, path: 'projects/*/zones/*/instanceGroupManagers/*', type: 'google_compute_instance_group_manager' },
    { assetType: `${C}/InstanceGroupManager`, path: 'projects/*/regions/*/instanceGroupManagers/*', type: 'google_compute_region_instance_group_manager' },
    // Only zonal unmanaged groups; regional instance groups always belong to a regional MIG.
    { assetType: `${C}/InstanceGroup`, path: 'projects/*/zones/*/instanceGroups/*', type: 'google_compute_instance_group' },
    { assetType: `${C}/Autoscaler`, path: 'projects/*/zones/*/autoscalers/*', type: 'google_compute_autoscaler' },
    { assetType: `${C}/Autoscaler`, path: 'projects/*/regions/*/autoscalers/*', type: 'google_compute_region_autoscaler' },
    // The search API returns global and regional addresses under compute.googleapis.com/Address.
    { assetType: `${C}/Address`, path: 'projects/*/regions/*/addresses/*', type: 'google_compute_address' },
    { assetType: `${C}/Address`, path: 'projects/*/global/addresses/*', type: 'google_compute_global_address' },
    { assetType: `${C}/ResourcePolicy`, path: 'projects/*/regions/*/resourcePolicies/*', type: 'google_compute_resource_policy' },
    { assetType: `${C}/Reservation`, path: 'projects/*/zones/*/reservations/*', type: 'google_compute_reservation' }
  ];

  /** `zone/name` of instances created by a managed instance group or GKE. */
  private managedInstances = new Set<string>();
  /** `zone/name` and `region/name` of managed instance groups. */
  private groupManagers = new Set<string>();

  protected prepare(assets: GoogleAsset[]): void {
    for (const asset of assets) {
      const m = /^projects\/[^/]+\/(?:zones|regions)\/([^/]+)\/instanceGroupManagers\/([^/]+)$/.exec(asset.path);
      if (asset.assetType === `${C}/InstanceGroupManager` && m) {
        this.groupManagers.add(`${m[1]}/${m[2]}`);
      }
    }
    for (const asset of assets) {
      const m = /^projects\/[^/]+\/zones\/([^/]+)\/instances\/([^/]+)$/.exec(asset.path);
      if (asset.assetType !== `${C}/Instance` || !m) {
        continue;
      }
      const [, zone, name] = m;
      const owned = GKE_LABELS.some(key => key in asset.labels) || this.isMigInstance(zone, name);
      if (owned) {
        this.managedInstances.add(`${zone}/${name}`);
      }
    }
  }

  /**
   * MIG instances are named `<base instance name>-<4 random chars>`, the base name
   * defaulting to the MIG name. The asset search does not return the `created-by`
   * metadata, so this name pattern is how MIG members are recognized.
   */
  private isMigInstance(zone: string, name: string): boolean {
    const m = /^(.+)-[a-z0-9]{4}$/.exec(name);
    return Boolean(m && (this.groupManagers.has(`${zone}/${m[1]}`) || this.groupManagers.has(`${zoneRegion(zone)}/${m[1]}`)));
  }

  protected skip(asset: GoogleAsset): string | undefined {
    const name = lastSegment(asset.path);
    const zone = /\/zones\/([^/]+)\//.exec(asset.path)?.[1];
    switch (asset.assetType) {
      case `${C}/Instance`:
      case `${C}/Disk`:
        // Disks named like a managed instance are its boot disk.
        return zone && this.managedInstances.has(`${zone}/${name}`) ? 'created by a managed instance group or GKE' : undefined;
      case `${C}/InstanceGroupManager`:
      case `${C}/InstanceTemplate`:
        return name.startsWith('gke-') ? 'created by a GKE node pool' : undefined;
      case `${C}/InstanceGroup`:
        if (name.startsWith('gke-') || name.startsWith('k8s-ig--')) {
          return 'created by GKE';
        }
        // A MIG creates an instance group with its own name.
        return zone && this.groupManagers.has(`${zone}/${name}`) ? 'instance group of a managed instance group' : undefined;
      case `${C}/Address`:
        return isKubernetesManaged(asset) ? 'created by GKE' : undefined;
    }
    return undefined;
  }
}

/** Objects created by the GKE ingress / service controllers. */
export function isKubernetesManaged(asset: GoogleAsset): boolean {
  return /kubernetes\.io\//.test(asset.description) || /^k8s[0-9]?-/.test(lastSegment(asset.path));
}
