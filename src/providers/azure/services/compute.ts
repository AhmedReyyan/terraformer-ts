import { ComputeManagementClient, VirtualMachine, VirtualMachineScaleSet } from '@azure/arm-compute';
import { AzureService, ArmInventory } from '../azure-service';
import { findMapping } from '../arm-types';
import { idKey } from '../arm-id';

const VM = 'Microsoft.Compute/virtualMachines';
const VMSS = 'Microsoft.Compute/virtualMachineScaleSets';
const DISK = 'Microsoft.Compute/disks';
const EXTENSION = 'Microsoft.Compute/virtualMachines/extensions';
const DATA_DISK = 'Microsoft.Compute/virtualMachines/dataDisks';

type OsType = 'linux' | 'windows' | undefined;

/** OS of a VM: the OS disk's osType, else the OS profile's configuration block. */
export function vmOsType(vm: VirtualMachine): OsType {
  const osType = vm.storageProfile?.osDisk?.osType?.toLowerCase();
  if (osType === 'linux' || osType === 'windows') {
    return osType;
  }
  if (vm.osProfile?.linuxConfiguration) return 'linux';
  if (vm.osProfile?.windowsConfiguration) return 'windows';
  return undefined;
}

/** azurerm type of a scale set: Flexible = orchestrated (any OS), Uniform = linux/windows. */
export function scaleSetType(vmss: VirtualMachineScaleSet): string | undefined {
  if (vmss.orchestrationMode?.toLowerCase() === 'flexible') {
    return 'azurerm_orchestrated_virtual_machine_scale_set';
  }
  const profile = vmss.virtualMachineProfile;
  const osType = profile?.storageProfile?.osDisk?.osType?.toLowerCase()
    || (profile?.osProfile?.linuxConfiguration ? 'linux' : profile?.osProfile?.windowsConfiguration ? 'windows' : undefined);
  if (osType === 'linux') return 'azurerm_linux_virtual_machine_scale_set';
  if (osType === 'windows') return 'azurerm_windows_virtual_machine_scale_set';
  return undefined;
}

/**
 * Virtual machines (linux/windows by OS), scale sets (linux/windows/orchestrated), managed disks,
 * data disk attachments and VM extensions, plus the remaining Microsoft.Compute types.
 *
 * Skip rules:
 * - VMs created by a Flexible scale set with a VM profile (the scale set owns them);
 * - OS disks (managed by the VM's os_disk block) and disks attached to VMs that are not imported
 *   (e.g. scale set instances); attached data disks of imported VMs become
 *   azurerm_managed_disk + azurerm_virtual_machine_data_disk_attachment;
 * - extensions of VMs that are not imported.
 */
export class ComputeService extends AzureService {
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
    const compute = this.client(ComputeManagementClient);

    const scaleSetsWithProfile = new Set<string>();
    await this.collect('virtual machine scale sets', async () => {
      const scaleSets = this.resourceGroup ? compute.virtualMachineScaleSets.list(this.resourceGroup) : compute.virtualMachineScaleSets.listAll();
      for await (const vmss of scaleSets) {
        if (!vmss.id) continue;
        if (vmss.virtualMachineProfile) {
          scaleSetsWithProfile.add(idKey(vmss.id));
        }
        const reason = this.skipReason(inv, vmss.id);
        if (reason) {
          this.log(`Skipping ${vmss.id}: ${reason}`, 'debug');
          continue;
        }
        const type = scaleSetType(vmss);
        if (!type) {
          this.unsupportedType(`${VMSS} (unknown OS)`, vmss.id);
          continue;
        }
        this.addArm(type, vmss.id, VMSS, vmss);
      }
    });

    const importedVms = new Set<string>();
    const osDisks = new Set<string>();
    await this.collect('virtual machines', async () => {
      const vms = this.resourceGroup ? compute.virtualMachines.list(this.resourceGroup) : compute.virtualMachines.listAll();
      for await (const vm of vms) {
        if (!vm.id) continue;
        const osDiskId = vm.storageProfile?.osDisk?.managedDisk?.id;
        if (osDiskId) {
          osDisks.add(idKey(osDiskId));
        }
        const reason = this.skipReason(inv, vm.id, vm.managedBy)
          || (vm.virtualMachineScaleSet?.id && scaleSetsWithProfile.has(idKey(vm.virtualMachineScaleSet.id))
            ? `created by scale set ${vm.virtualMachineScaleSet.id}` : undefined);
        if (reason) {
          this.log(`Skipping ${vm.id}: ${reason}`, 'debug');
          continue;
        }
        const os = vmOsType(vm);
        if (!os) {
          this.unsupportedType(`${VM} (unknown OS)`, vm.id);
          continue;
        }
        this.addArm(os === 'linux' ? 'azurerm_linux_virtual_machine' : 'azurerm_windows_virtual_machine', vm.id, VM, vm);
        importedVms.add(idKey(vm.id));
        for (const dataDisk of vm.storageProfile?.dataDisks || []) {
          if (dataDisk.managedDisk?.id && dataDisk.name) {
            this.addArm('azurerm_virtual_machine_data_disk_attachment', `${vm.id}/dataDisks/${dataDisk.name}`, DATA_DISK, { name: dataDisk.name });
          }
        }
      }
    });

    await this.collect('managed disks and VM extensions', async () => {
      for (const resource of inv.resources) {
        const armType = findMapping(resource.type)?.armType;
        if (armType === DISK) {
          // Disks report the VM they are attached to in managedBy.
          const owner = resource.managedBy;
          const reason = this.skipReason(inv, resource.id)
            || (osDisks.has(idKey(resource.id)) ? 'OS disk (managed by the virtual machine)' : undefined)
            || (owner && !importedVms.has(idKey(owner)) ? `attached to ${owner}, which is not imported` : undefined);
          if (reason) {
            this.log(`Skipping ${resource.id}: ${reason}`, 'debug');
            continue;
          }
          this.addArm('azurerm_managed_disk', resource.id, DISK, resource);
        } else if (armType === EXTENSION) {
          const vmId = resource.id.replace(/\/extensions\/[^/]+$/i, '');
          if (this.skipReason(inv, resource.id, resource.managedBy) || !importedVms.has(idKey(vmId))) {
            this.log(`Skipping ${resource.id}: its virtual machine is not imported`, 'debug');
            continue;
          }
          this.addArm('azurerm_virtual_machine_extension', resource.id, EXTENSION, resource);
        }
      }
    });

    this.reportUnsupported();
  }
}
