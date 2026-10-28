import { AzureService } from '../azure-service';
import { normalizeResourceGroupId } from '../arm-id';

/**
 * Resource groups. Groups whose `managedBy` is set (AKS node resource groups `MC_*`,
 * Databricks / Synapse managed resource groups, ...) are owned by that resource and skipped.
 * This service also reports resources of ARM namespaces that no other service knows.
 */
export class ResourceGroupService extends AzureService {
  async initResources(): Promise<void> {
    await this.collect('resource groups', async () => {
      const inventory = await this.inventory();
      for (const group of inventory.resourceGroups) {
        if (group.managedBy) {
          this.log(`Skipping resource group ${group.name}: managed by ${group.managedBy}`, 'debug');
          continue;
        }
        const attributes: Record<string, any> = { name: group.name, location: group.location };
        if (group.tags && Object.keys(group.tags).length > 0) {
          attributes.tags = { ...group.tags };
        }
        this.add('azurerm_resource_group', normalizeResourceGroupId(group.id), group.name, attributes);
      }
      await this.importMapped(inventory);
    });
    this.reportUnsupported();
  }
}
