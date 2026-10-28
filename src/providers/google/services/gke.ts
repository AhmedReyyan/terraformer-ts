import { AssetRule, GoogleAsset, GoogleService } from '../google-service';

const K = 'container.googleapis.com';

/**
 * GKE clusters and node pools (node pools are imported as separate resources, as
 * the provider recommends). Asset names use `zones/` or `locations/`; the import
 * ID always uses the location.
 */
export class GkeService extends GoogleService {
  protected readonly rules: AssetRule[] = [
    {
      assetType: `${K}/Cluster`, path: 'projects/*/*/*/clusters/*', type: 'google_container_cluster',
      id: m => locationKind(m[2]) ? `projects/${m[1]}/locations/${m[3]}/clusters/${m[4]}` : undefined
    },
    {
      assetType: `${K}/NodePool`, path: 'projects/*/*/*/clusters/*/nodePools/*', type: 'google_container_node_pool',
      id: m => locationKind(m[2]) ? `${m[1]}/${m[3]}/${m[4]}/${m[5]}` : undefined,
      name: m => `${m[4]}_${m[5]}`
    }
  ];

  /** Clusters skipped because another service owns them (e.g. Composer). */
  private skippedClusters = new Set<string>();

  protected prepare(assets: GoogleAsset[]): void {
    for (const asset of assets) {
      if (asset.assetType === `${K}/Cluster` && this.ownerLabels.some(key => key in asset.labels)) {
        this.skippedClusters.add(clusterKey(asset.path));
      }
    }
  }

  protected skip(asset: GoogleAsset): string | undefined {
    if (asset.assetType === `${K}/NodePool` && this.skippedClusters.has(clusterKey(asset.path))) {
      return 'node pool of a cluster managed by another service';
    }
    return undefined;
  }
}

function locationKind(segment: string): boolean {
  return segment === 'locations' || segment === 'zones';
}

/** `projects/p/zones/z/clusters/c[/nodePools/np]` -> `z/c`. */
function clusterKey(path: string): string {
  const m = /^projects\/[^/]+\/[^/]+\/([^/]+)\/clusters\/([^/]+)/.exec(path);
  return m ? `${m[1]}/${m[2]}` : path;
}
