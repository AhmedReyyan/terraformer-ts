import { NetworkManagementClient, VirtualNetwork } from '@azure/arm-network';
import { AzureService } from '../azure-service';
import { idKey } from '../arm-id';

const SUBNET = 'Microsoft.Network/virtualNetworks/subnets';
const PEERING = 'Microsoft.Network/virtualNetworks/virtualNetworkPeerings';

/**
 * Virtual networks and the rest of Microsoft.Network (see arm-types.ts), plus the child
 * resources the generic listing does not return: subnets, their NSG / route table / NAT gateway
 * associations (import ID = subnet ID) and VNet peerings (not inline in azurerm_virtual_network).
 * NSG rules and routes are inline in their parents and are not imported separately.
 */
export class NetworkService extends AzureService {
  async initResources(): Promise<void> {
    const network = this.client(NetworkManagementClient);
    const inventory = await this.inventory().catch(error => {
      this.warn(`resources: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    });
    if (!inventory) {
      return;
    }

    // NICs created for private endpoints / private link services are owned by those resources.
    const ownedNics = new Set<string>();
    await this.collect('network interfaces', async () => {
      const nics = this.resourceGroup ? network.networkInterfaces.list(this.resourceGroup) : network.networkInterfaces.listAll();
      for await (const nic of nics) {
        if (nic.id && (nic.privateEndpoint || nic.privateLinkService)) {
          ownedNics.add(idKey(nic.id));
        }
      }
    });

    await this.collect('resources', () => this.importMapped(inventory, ownedNics));

    await this.collect('subnets and peerings', async () => {
      const vnets = this.resourceGroup ? network.virtualNetworks.list(this.resourceGroup) : network.virtualNetworks.listAll();
      for await (const vnet of vnets) {
        if (vnet.id && !this.skipReason(inventory, vnet.id)) {
          this.addVnetChildren(vnet);
        }
      }
    });

    this.reportUnsupported();
  }

  private addVnetChildren(vnet: VirtualNetwork): void {
    for (const subnet of vnet.subnets || []) {
      if (!subnet.id) {
        continue;
      }
      this.addArm('azurerm_subnet', subnet.id, SUBNET, { name: subnet.name });
      if (subnet.networkSecurityGroup?.id) {
        this.addArm('azurerm_subnet_network_security_group_association', subnet.id, SUBNET, { name: subnet.name });
      }
      if (subnet.routeTable?.id) {
        this.addArm('azurerm_subnet_route_table_association', subnet.id, SUBNET, { name: subnet.name });
      }
      if (subnet.natGateway?.id) {
        this.addArm('azurerm_subnet_nat_gateway_association', subnet.id, SUBNET, { name: subnet.name });
      }
    }
    for (const peering of vnet.virtualNetworkPeerings || []) {
      if (peering.id) {
        this.addArm('azurerm_virtual_network_peering', peering.id, PEERING, { name: peering.name });
      }
    }
  }
}
