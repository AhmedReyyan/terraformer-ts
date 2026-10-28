import { ResourceManagementClient } from '@azure/arm-resources';
import { mapLimit } from '../../../core/provider';
import { AzureService, ArmInventory } from '../azure-service';
import { ArmResource, findMapping, webAppType } from '../arm-types';

const SITE = 'Microsoft.Web/sites';
const WEB_API_VERSION = '2023-12-01';

/**
 * App Service: plans, web/function apps and slots (resolved by `kind`, see `webAppType`),
 * static web apps, App Service Environments v3 and API connections.
 * Linux function apps are read once more to tell Flex Consumption apps (they have
 * `functionAppConfig`, a separate azurerm type) from regular ones.
 */
export class WebService extends AzureService {
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
    const linuxFunctionApps: ArmResource[] = [];

    for (const site of inv.resources) {
      if (findMapping(site.type)?.armType !== SITE) {
        continue;
      }
      const reason = this.skipReason(inv, site.id, site.managedBy);
      if (reason) {
        this.log(`Skipping ${site.id}: ${reason}`, 'debug');
        continue;
      }
      const type = webAppType(site.kind);
      if (!type) {
        this.unsupportedType(`${SITE} (kind=${site.kind || 'none'})`, site.id);
      } else if (type === 'azurerm_linux_function_app') {
        linuxFunctionApps.push(site);
      } else {
        this.addArm(type, site.id, SITE, site);
      }
    }

    const arm = this.client(ResourceManagementClient);
    await mapLimit(linuxFunctionApps, 5, site => this.collect(`function app ${site.name}`, async () => {
      const details = await arm.resources.getById(site.id, WEB_API_VERSION);
      const flex = Boolean(details.properties?.functionAppConfig);
      this.addArm(flex ? 'azurerm_function_app_flex_consumption' : 'azurerm_linux_function_app', site.id, SITE, site);
    }));

    this.reportUnsupported();
  }
}
