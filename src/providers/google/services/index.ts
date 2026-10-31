import { BaseService } from '../../../core/provider';
import { NetworkService } from './network';
import { ComputeService } from './compute';
import { StorageService } from './storage';
import { IamService } from './iam';
import { GkeService } from './gke';
import { SqlService } from './sql';
import { DnsService } from './dns';
import { PubSubService } from './pubsub';
import { KmsService } from './kms';
import { SecretManagerService } from './secretmanager';
import { BigQueryService } from './bigquery';
import { FunctionsService } from './functions';
import { RunService } from './run';
import { LoadBalancingService } from './loadbalancing';

/** Google Cloud services, keyed by the name used with --resources. */
export const GOOGLE_SERVICES: Record<string, typeof BaseService> = {
  network: NetworkService,
  compute: ComputeService,
  storage: StorageService,
  iam: IamService,
  gke: GkeService,
  sql: SqlService,
  dns: DnsService,
  pubsub: PubSubService,
  kms: KmsService,
  secretmanager: SecretManagerService,
  bigquery: BigQueryService,
  functions: FunctionsService,
  run: RunService,
  loadbalancing: LoadBalancingService
};
