import { BaseService } from '../../../core/provider';
import { MappedService } from '../azure-service';
import { ResourceGroupService } from './resource-group';
import { NetworkService } from './network';
import { ComputeService } from './compute';
import { ContainersService } from './containers';
import { WebService } from './web';

/**
 * Azure services. Services mapped to `MappedService` import the ARM types listed for their
 * key in arm-types.ts from the shared subscription listing; the others need extra API calls.
 */
export const AZURE_SERVICES: Record<string, typeof BaseService> = {
  resource_group: ResourceGroupService,
  network: NetworkService,
  dns: MappedService,
  compute: ComputeService,
  storage: MappedService,
  web: WebService,
  sql: MappedService,
  postgresql: MappedService,
  mysql: MappedService,
  cosmosdb: MappedService,
  keyvault: MappedService,
  containers: ContainersService,
  monitor: MappedService,
  servicebus: MappedService,
  eventhub: MappedService,
  eventgrid: MappedService,
  messaging: MappedService,
  redis: MappedService,
  identity: MappedService,
  apim: MappedService,
  cdn: MappedService,
  search: MappedService,
  cognitive: MappedService,
  datafactory: MappedService,
  automation: MappedService,
  recovery_services: MappedService,
  logic: MappedService,
  appconfiguration: MappedService,
  analytics: MappedService
};
