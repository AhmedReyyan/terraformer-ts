import { ResourceManagementClient } from '@azure/arm-resources';
import { mapLimit } from '../../../core/provider';
import { AzureService, ArmInventory } from '../azure-service';
import { findMapping } from '../arm-types';

const CLUSTER = 'Microsoft.ContainerService/managedClusters';
const NODE_POOL = 'Microsoft.ContainerService/managedClusters/agentPools';
const AKS_API_VERSION = '2024-09-01';

interface AgentPoolProfile {
  name?: string;
  mode?: string;
}

/**
 * Node pools that are imported as azurerm_kubernetes_cluster_node_pool: every pool except the
 * one azurerm reads into `default_node_pool` (on import: the first pool in System mode).
 */
export function additionalNodePools(profiles: AgentPoolProfile[]): string[] {
  const defaultPool = profiles.find(profile => profile.name && profile.mode?.toLowerCase() === 'system');
  return profiles
    .filter(profile => profile.name && profile !== defaultPool)
    .map(profile => profile.name as string);
}

/**
 * AKS clusters (+ node pools), container registries (+ webhooks), Container Apps
 * (environments, apps, jobs) and container groups. The cluster's node resource group is
 * managed by AKS (its managedBy is set) and is skipped with everything in it.
 */
export class ContainersService extends AzureService {
  async initResources(): Promise<void> {
    let inventory: ArmInventory | undefined;
    await this.collect('resources', async () => {
      inventory = await this.inventory();
      await this.importMapped(inventory);
    });
    if (!inventory) {
      return;
    }
    const inv = inventory;
    const clusters = inv.resources.filter(resource => findMapping(resource.type)?.armType === CLUSTER);
    const arm = this.client(ResourceManagementClient);

    await mapLimit(clusters, 5, cluster => this.collect(`kubernetes cluster ${cluster.name}`, async () => {
      const reason = this.skipReason(inv, cluster.id, cluster.managedBy);
      if (reason) {
        this.log(`Skipping ${cluster.id}: ${reason}`, 'debug');
        return;
      }
      this.addArm('azurerm_kubernetes_cluster', cluster.id, CLUSTER, cluster);
      const details = await arm.resources.getById(cluster.id, AKS_API_VERSION);
      const profiles = (details.properties?.agentPoolProfiles || []) as AgentPoolProfile[];
      for (const pool of additionalNodePools(profiles)) {
        this.addArm('azurerm_kubernetes_cluster_node_pool', `${cluster.id}/agentPools/${pool}`, NODE_POOL, { name: pool });
      }
    }));

    this.reportUnsupported();
  }
}
