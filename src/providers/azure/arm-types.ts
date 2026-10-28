/**
 * ARM resource type -> azurerm resource type mapping for resources returned by the
 * subscription-wide generic listing (`ResourceManagementClient.resources.list`).
 *
 * `armType` is spelled exactly like the type segments of the import example in the azurerm
 * docs: it is used to normalize the casing of every import ID (see `normalizeArmId`).
 * The import ID of every type below is the ARM resource ID (verified against the "Import"
 * section of each resource's documentation).
 */

/** The subset of a generic ARM resource the mapping looks at. */
export interface ArmResource {
  id: string;
  /** ARM type as returned by the API (casing varies). */
  type: string;
  name: string;
  kind?: string;
  location?: string;
  managedBy?: string;
  sku?: { name?: string; tier?: string };
  tags?: Record<string, string>;
}

export interface ArmMapping {
  /** terraformer service key that imports this type. */
  service: string;
  /** Canonical ARM type (casing of the documented import ID). */
  armType: string;
  /** Terraform type, or a resolver for kind/sku dependent types (undefined = unsupported variant). */
  terraformType: string | ((resource: ArmResource) => string | undefined);
  /** Returns a reason when a resource of this type must not be imported. */
  skip?: (resource: ArmResource) => string | undefined;
  /** Imported by the owning service's own code (needs more than the generic listing). */
  custom?: boolean;
}

const lower = (value: string | undefined): string => (value || '').toLowerCase();
const kindTokens = (kind: string | undefined): Set<string> =>
  new Set(lower(kind).split(',').map(token => token.trim()).filter(Boolean));
const lastName = (id: string): string => id.split('/').filter(Boolean).pop() || '';

/**
 * App Service apps (`Microsoft.Web/sites` and `/slots`) by `kind`, e.g. `app`, `app,linux`,
 * `app,container,windows`, `functionapp`, `functionapp,linux`. Logic Apps Standard
 * (`workflowapp`), Arc (`kubernetes`) and Functions on Container Apps are not mapped.
 */
export function webAppType(kind: string | undefined, slot = false): string | undefined {
  const tokens = kindTokens(kind);
  if (['workflowapp', 'kubernetes', 'azurecontainerapps'].some(token => tokens.has(token))) {
    return undefined;
  }
  const linux = tokens.has('linux');
  if (tokens.has('functionapp')) {
    if (slot) {
      return linux ? 'azurerm_linux_function_app_slot' : 'azurerm_windows_function_app_slot';
    }
    return linux ? 'azurerm_linux_function_app' : 'azurerm_windows_function_app';
  }
  if (tokens.has('app')) {
    if (slot) {
      return linux ? 'azurerm_linux_web_app_slot' : 'azurerm_windows_web_app_slot';
    }
    return linux ? 'azurerm_linux_web_app' : 'azurerm_windows_web_app';
  }
  return undefined;
}

const isFrontDoorSku = (resource: ArmResource): boolean =>
  /^(standard|premium)_azurefrontdoor$/.test(lower(resource.sku?.name));

export const ARM_MAPPINGS: ArmMapping[] = [
  // network (listed before dns/cdn: the first service using a namespace reports its unmapped types)
  { service: 'network', armType: 'Microsoft.Network/virtualNetworks', terraformType: 'azurerm_virtual_network' },
  { service: 'network', armType: 'Microsoft.Network/networkSecurityGroups', terraformType: 'azurerm_network_security_group' },
  { service: 'network', armType: 'Microsoft.Network/routeTables', terraformType: 'azurerm_route_table' },
  { service: 'network', armType: 'Microsoft.Network/publicIPAddresses', terraformType: 'azurerm_public_ip' },
  { service: 'network', armType: 'Microsoft.Network/publicIPPrefixes', terraformType: 'azurerm_public_ip_prefix' },
  { service: 'network', armType: 'Microsoft.Network/networkInterfaces', terraformType: 'azurerm_network_interface' },
  { service: 'network', armType: 'Microsoft.Network/loadBalancers', terraformType: 'azurerm_lb' },
  { service: 'network', armType: 'Microsoft.Network/applicationGateways', terraformType: 'azurerm_application_gateway' },
  { service: 'network', armType: 'Microsoft.Network/applicationGatewayWebApplicationFirewallPolicies', terraformType: 'azurerm_web_application_firewall_policy' },
  { service: 'network', armType: 'Microsoft.Network/natGateways', terraformType: 'azurerm_nat_gateway' },
  { service: 'network', armType: 'Microsoft.Network/privateEndpoints', terraformType: 'azurerm_private_endpoint' },
  { service: 'network', armType: 'Microsoft.Network/privateLinkServices', terraformType: 'azurerm_private_link_service' },
  { service: 'network', armType: 'Microsoft.Network/bastionHosts', terraformType: 'azurerm_bastion_host' },
  { service: 'network', armType: 'Microsoft.Network/azureFirewalls', terraformType: 'azurerm_firewall' },
  { service: 'network', armType: 'Microsoft.Network/firewallPolicies', terraformType: 'azurerm_firewall_policy' },
  { service: 'network', armType: 'Microsoft.Network/applicationSecurityGroups', terraformType: 'azurerm_application_security_group' },
  { service: 'network', armType: 'Microsoft.Network/virtualNetworkGateways', terraformType: 'azurerm_virtual_network_gateway' },
  { service: 'network', armType: 'Microsoft.Network/localNetworkGateways', terraformType: 'azurerm_local_network_gateway' },
  { service: 'network', armType: 'Microsoft.Network/connections', terraformType: 'azurerm_virtual_network_gateway_connection' },
  { service: 'network', armType: 'Microsoft.Network/ddosProtectionPlans', terraformType: 'azurerm_network_ddos_protection_plan' },
  // Network watchers are auto-created by Azure (NetworkWatcherRG) but are ordinary, manageable
  // resources that flow logs reference, so they are imported.
  { service: 'network', armType: 'Microsoft.Network/networkWatchers', terraformType: 'azurerm_network_watcher' },
  { service: 'network', armType: 'Microsoft.Network/networkWatchers/flowLogs', terraformType: 'azurerm_network_watcher_flow_log' },
  { service: 'network', armType: 'Microsoft.Network/ipGroups', terraformType: 'azurerm_ip_group' },
  { service: 'network', armType: 'Microsoft.Network/expressRouteCircuits', terraformType: 'azurerm_express_route_circuit' },
  { service: 'network', armType: 'Microsoft.Network/expressRouteGateways', terraformType: 'azurerm_express_route_gateway' },
  { service: 'network', armType: 'Microsoft.Network/virtualWans', terraformType: 'azurerm_virtual_wan' },
  { service: 'network', armType: 'Microsoft.Network/virtualHubs', terraformType: 'azurerm_virtual_hub' },
  { service: 'network', armType: 'Microsoft.Network/vpnGateways', terraformType: 'azurerm_vpn_gateway' },
  { service: 'network', armType: 'Microsoft.Network/vpnSites', terraformType: 'azurerm_vpn_site' },
  { service: 'network', armType: 'Microsoft.Network/p2sVpnGateways', terraformType: 'azurerm_point_to_site_vpn_gateway' },
  { service: 'network', armType: 'Microsoft.Network/routeFilters', terraformType: 'azurerm_route_filter' },
  { service: 'network', armType: 'Microsoft.Network/trafficManagerProfiles', terraformType: 'azurerm_traffic_manager_profile' },
  { service: 'network', armType: 'Microsoft.Network/networkManagers', terraformType: 'azurerm_network_manager' },

  // dns
  { service: 'dns', armType: 'Microsoft.Network/dnsZones', terraformType: 'azurerm_dns_zone' },
  { service: 'dns', armType: 'Microsoft.Network/privateDnsZones', terraformType: 'azurerm_private_dns_zone' },
  { service: 'dns', armType: 'Microsoft.Network/privateDnsZones/virtualNetworkLinks', terraformType: 'azurerm_private_dns_zone_virtual_network_link' },
  { service: 'dns', armType: 'Microsoft.Network/dnsResolvers', terraformType: 'azurerm_private_dns_resolver' },
  { service: 'dns', armType: 'Microsoft.Network/dnsResolvers/inboundEndpoints', terraformType: 'azurerm_private_dns_resolver_inbound_endpoint' },
  { service: 'dns', armType: 'Microsoft.Network/dnsResolvers/outboundEndpoints', terraformType: 'azurerm_private_dns_resolver_outbound_endpoint' },
  { service: 'dns', armType: 'Microsoft.Network/dnsForwardingRulesets', terraformType: 'azurerm_private_dns_resolver_dns_forwarding_ruleset' },

  // compute (VMs, scale sets, disks and VM extensions need the Compute API: see services/compute.ts)
  { service: 'compute', armType: 'Microsoft.Compute/virtualMachines', terraformType: 'azurerm_linux_virtual_machine', custom: true },
  { service: 'compute', armType: 'Microsoft.Compute/virtualMachineScaleSets', terraformType: 'azurerm_linux_virtual_machine_scale_set', custom: true },
  { service: 'compute', armType: 'Microsoft.Compute/disks', terraformType: 'azurerm_managed_disk', custom: true },
  { service: 'compute', armType: 'Microsoft.Compute/virtualMachines/extensions', terraformType: 'azurerm_virtual_machine_extension', custom: true },
  { service: 'compute', armType: 'Microsoft.Compute/availabilitySets', terraformType: 'azurerm_availability_set' },
  { service: 'compute', armType: 'Microsoft.Compute/snapshots', terraformType: 'azurerm_snapshot' },
  { service: 'compute', armType: 'Microsoft.Compute/images', terraformType: 'azurerm_image' },
  { service: 'compute', armType: 'Microsoft.Compute/galleries', terraformType: 'azurerm_shared_image_gallery' },
  { service: 'compute', armType: 'Microsoft.Compute/galleries/images', terraformType: 'azurerm_shared_image' },
  { service: 'compute', armType: 'Microsoft.Compute/galleries/images/versions', terraformType: 'azurerm_shared_image_version' },
  { service: 'compute', armType: 'Microsoft.Compute/proximityPlacementGroups', terraformType: 'azurerm_proximity_placement_group' },
  { service: 'compute', armType: 'Microsoft.Compute/sshPublicKeys', terraformType: 'azurerm_ssh_public_key' },
  { service: 'compute', armType: 'Microsoft.Compute/diskEncryptionSets', terraformType: 'azurerm_disk_encryption_set' },
  { service: 'compute', armType: 'Microsoft.Compute/diskAccesses', terraformType: 'azurerm_disk_access' },
  { service: 'compute', armType: 'Microsoft.Compute/hostGroups', terraformType: 'azurerm_dedicated_host_group' },
  { service: 'compute', armType: 'Microsoft.Compute/hostGroups/hosts', terraformType: 'azurerm_dedicated_host' },
  { service: 'compute', armType: 'Microsoft.Compute/capacityReservationGroups', terraformType: 'azurerm_capacity_reservation_group' },
  { service: 'compute', armType: 'Microsoft.Compute/capacityReservationGroups/capacityReservations', terraformType: 'azurerm_capacity_reservation' },
  { service: 'compute', armType: 'Microsoft.SqlVirtualMachine/sqlVirtualMachines', terraformType: 'azurerm_mssql_virtual_machine' },

  // storage
  { service: 'storage', armType: 'Microsoft.Storage/storageAccounts', terraformType: 'azurerm_storage_account' },

  // web (sites and slots are resolved by kind in services/web.ts)
  { service: 'web', armType: 'Microsoft.Web/serverFarms', terraformType: 'azurerm_service_plan' },
  { service: 'web', armType: 'Microsoft.Web/sites', terraformType: resource => webAppType(resource.kind), custom: true },
  { service: 'web', armType: 'Microsoft.Web/sites/slots', terraformType: resource => webAppType(resource.kind, true) },
  { service: 'web', armType: 'Microsoft.Web/staticSites', terraformType: 'azurerm_static_web_app' },
  {
    service: 'web',
    armType: 'Microsoft.Web/hostingEnvironments',
    // Only App Service Environment v3 is supported by azurerm v4 (v1/v2 are retired).
    terraformType: resource => lower(resource.kind) === 'asev3' ? 'azurerm_app_service_environment_v3' : undefined
  },
  { service: 'web', armType: 'Microsoft.Web/connections', terraformType: 'azurerm_api_connection' },

  // sql
  { service: 'sql', armType: 'Microsoft.Sql/servers', terraformType: 'azurerm_mssql_server' },
  {
    service: 'sql',
    armType: 'Microsoft.Sql/servers/databases',
    terraformType: 'azurerm_mssql_database',
    skip: resource => lower(lastName(resource.id)) === 'master' ? 'system database' : undefined
  },
  { service: 'sql', armType: 'Microsoft.Sql/servers/elasticPools', terraformType: 'azurerm_mssql_elasticpool' },
  { service: 'sql', armType: 'Microsoft.Sql/managedInstances', terraformType: 'azurerm_mssql_managed_instance' },
  { service: 'sql', armType: 'Microsoft.Sql/managedInstances/databases', terraformType: 'azurerm_mssql_managed_database' },

  { service: 'postgresql', armType: 'Microsoft.DBforPostgreSQL/flexibleServers', terraformType: 'azurerm_postgresql_flexible_server' },
  { service: 'mysql', armType: 'Microsoft.DBforMySQL/flexibleServers', terraformType: 'azurerm_mysql_flexible_server' },

  { service: 'cosmosdb', armType: 'Microsoft.DocumentDB/databaseAccounts', terraformType: 'azurerm_cosmosdb_account' },
  { service: 'cosmosdb', armType: 'Microsoft.DocumentDB/mongoClusters', terraformType: 'azurerm_mongo_cluster' },

  { service: 'keyvault', armType: 'Microsoft.KeyVault/vaults', terraformType: 'azurerm_key_vault' },
  { service: 'keyvault', armType: 'Microsoft.KeyVault/managedHSMs', terraformType: 'azurerm_key_vault_managed_hardware_security_module' },

  // containers (AKS clusters and node pools need the cluster properties: see services/containers.ts)
  { service: 'containers', armType: 'Microsoft.ContainerService/managedClusters', terraformType: 'azurerm_kubernetes_cluster', custom: true },
  { service: 'containers', armType: 'Microsoft.ContainerRegistry/registries', terraformType: 'azurerm_container_registry' },
  { service: 'containers', armType: 'Microsoft.ContainerRegistry/registries/webHooks', terraformType: 'azurerm_container_registry_webhook' },
  {
    service: 'containers',
    armType: 'Microsoft.ContainerRegistry/registries/replications',
    terraformType: 'azurerm_container_registry',
    skip: () => 'managed inline by azurerm_container_registry.georeplications'
  },
  { service: 'containers', armType: 'Microsoft.App/managedEnvironments', terraformType: 'azurerm_container_app_environment' },
  { service: 'containers', armType: 'Microsoft.App/containerApps', terraformType: 'azurerm_container_app' },
  { service: 'containers', armType: 'Microsoft.App/jobs', terraformType: 'azurerm_container_app_job' },
  { service: 'containers', armType: 'Microsoft.ContainerInstance/containerGroups', terraformType: 'azurerm_container_group' },

  // monitor
  { service: 'monitor', armType: 'Microsoft.OperationalInsights/workspaces', terraformType: 'azurerm_log_analytics_workspace' },
  { service: 'monitor', armType: 'Microsoft.OperationalInsights/queryPacks', terraformType: 'azurerm_log_analytics_query_pack' },
  { service: 'monitor', armType: 'Microsoft.OperationsManagement/solutions', terraformType: 'azurerm_log_analytics_solution' },
  { service: 'monitor', armType: 'Microsoft.Insights/components', terraformType: 'azurerm_application_insights' },
  { service: 'monitor', armType: 'Microsoft.Insights/actionGroups', terraformType: 'azurerm_monitor_action_group' },
  { service: 'monitor', armType: 'Microsoft.Insights/metricAlerts', terraformType: 'azurerm_monitor_metric_alert' },
  { service: 'monitor', armType: 'Microsoft.Insights/activityLogAlerts', terraformType: 'azurerm_monitor_activity_log_alert' },
  {
    service: 'monitor',
    armType: 'Microsoft.Insights/scheduledQueryRules',
    // kind LogAlert = the current (v2) log alert API; legacy rules use other resources.
    terraformType: resource => lower(resource.kind) === 'logalert' ? 'azurerm_monitor_scheduled_query_rules_alert_v2' : undefined
  },
  { service: 'monitor', armType: 'Microsoft.Insights/autoScaleSettings', terraformType: 'azurerm_monitor_autoscale_setting' },
  { service: 'monitor', armType: 'Microsoft.Insights/dataCollectionRules', terraformType: 'azurerm_monitor_data_collection_rule' },
  { service: 'monitor', armType: 'Microsoft.Insights/dataCollectionEndpoints', terraformType: 'azurerm_monitor_data_collection_endpoint' },
  {
    service: 'monitor',
    armType: 'Microsoft.Insights/webTests',
    terraformType: resource => {
      switch (lower(resource.kind)) {
        case 'standard': return 'azurerm_application_insights_standard_web_test';
        case 'ping': return 'azurerm_application_insights_web_test';
        default: return undefined;
      }
    }
  },
  { service: 'monitor', armType: 'Microsoft.Insights/workbooks', terraformType: 'azurerm_application_insights_workbook' },
  { service: 'monitor', armType: 'Microsoft.AlertsManagement/smartDetectorAlertRules', terraformType: 'azurerm_monitor_smart_detector_alert_rule' },
  { service: 'monitor', armType: 'Microsoft.Monitor/accounts', terraformType: 'azurerm_monitor_workspace' },
  { service: 'monitor', armType: 'Microsoft.Dashboard/grafana', terraformType: 'azurerm_dashboard_grafana' },
  { service: 'monitor', armType: 'Microsoft.Portal/dashboards', terraformType: 'azurerm_portal_dashboard' },

  { service: 'servicebus', armType: 'Microsoft.ServiceBus/namespaces', terraformType: 'azurerm_servicebus_namespace' },
  { service: 'eventhub', armType: 'Microsoft.EventHub/namespaces', terraformType: 'azurerm_eventhub_namespace' },
  { service: 'eventhub', armType: 'Microsoft.EventHub/clusters', terraformType: 'azurerm_eventhub_cluster' },
  { service: 'eventgrid', armType: 'Microsoft.EventGrid/topics', terraformType: 'azurerm_eventgrid_topic' },
  { service: 'eventgrid', armType: 'Microsoft.EventGrid/systemTopics', terraformType: 'azurerm_eventgrid_system_topic' },
  { service: 'eventgrid', armType: 'Microsoft.EventGrid/domains', terraformType: 'azurerm_eventgrid_domain' },
  { service: 'eventgrid', armType: 'Microsoft.EventGrid/namespaces', terraformType: 'azurerm_eventgrid_namespace' },
  { service: 'messaging', armType: 'Microsoft.Relay/namespaces', terraformType: 'azurerm_relay_namespace' },
  { service: 'messaging', armType: 'Microsoft.NotificationHubs/namespaces', terraformType: 'azurerm_notification_hub_namespace' },
  { service: 'messaging', armType: 'Microsoft.NotificationHubs/namespaces/notificationHubs', terraformType: 'azurerm_notification_hub' },
  { service: 'messaging', armType: 'Microsoft.SignalRService/signalR', terraformType: 'azurerm_signalr_service' },
  { service: 'messaging', armType: 'Microsoft.SignalRService/webPubSub', terraformType: 'azurerm_web_pubsub' },
  { service: 'messaging', armType: 'Microsoft.Communication/communicationServices', terraformType: 'azurerm_communication_service' },

  { service: 'redis', armType: 'Microsoft.Cache/redis', terraformType: 'azurerm_redis_cache' },
  {
    service: 'redis',
    armType: 'Microsoft.Cache/redisEnterprise',
    // Enterprise_/EnterpriseFlash_ SKUs (legacy Redis Enterprise) are not supported by azurerm_managed_redis.
    terraformType: resource => /^enterprise/.test(lower(resource.sku?.name)) ? undefined : 'azurerm_managed_redis'
  },

  { service: 'identity', armType: 'Microsoft.ManagedIdentity/userAssignedIdentities', terraformType: 'azurerm_user_assigned_identity' },
  { service: 'apim', armType: 'Microsoft.ApiManagement/service', terraformType: 'azurerm_api_management' },

  // cdn / front door
  {
    service: 'cdn',
    armType: 'Microsoft.Cdn/profiles',
    terraformType: resource => isFrontDoorSku(resource) ? 'azurerm_cdn_frontdoor_profile' : 'azurerm_cdn_profile'
  },
  { service: 'cdn', armType: 'Microsoft.Cdn/profiles/endpoints', terraformType: 'azurerm_cdn_endpoint' },
  { service: 'cdn', armType: 'Microsoft.Cdn/profiles/afdEndpoints', terraformType: 'azurerm_cdn_frontdoor_endpoint' },
  { service: 'cdn', armType: 'Microsoft.Network/frontDoors', terraformType: 'azurerm_frontdoor' },
  {
    service: 'cdn',
    armType: 'Microsoft.Network/frontDoorWebApplicationFirewallPolicies',
    terraformType: resource => {
      if (isFrontDoorSku(resource)) {
        return 'azurerm_cdn_frontdoor_firewall_policy';
      }
      return lower(resource.sku?.name) === 'classic_azurefrontdoor' ? 'azurerm_frontdoor_firewall_policy' : undefined;
    }
  },

  { service: 'search', armType: 'Microsoft.Search/searchServices', terraformType: 'azurerm_search_service' },

  // cognitive / AI
  { service: 'cognitive', armType: 'Microsoft.CognitiveServices/accounts', terraformType: 'azurerm_cognitive_account' },
  { service: 'cognitive', armType: 'Microsoft.CognitiveServices/accounts/projects', terraformType: 'azurerm_cognitive_account_project' },
  {
    service: 'cognitive',
    armType: 'Microsoft.MachineLearningServices/workspaces',
    terraformType: resource => {
      switch (lower(resource.kind)) {
        case '':
        case 'default': return 'azurerm_machine_learning_workspace';
        case 'hub': return 'azurerm_ai_foundry';
        case 'project': return 'azurerm_ai_foundry_project';
        default: return undefined;
      }
    }
  },

  { service: 'datafactory', armType: 'Microsoft.DataFactory/factories', terraformType: 'azurerm_data_factory' },
  { service: 'automation', armType: 'Microsoft.Automation/automationAccounts', terraformType: 'azurerm_automation_account' },
  { service: 'automation', armType: 'Microsoft.Automation/automationAccounts/runbooks', terraformType: 'azurerm_automation_runbook' },
  { service: 'recovery_services', armType: 'Microsoft.RecoveryServices/vaults', terraformType: 'azurerm_recovery_services_vault' },
  { service: 'recovery_services', armType: 'Microsoft.DataProtection/backupVaults', terraformType: 'azurerm_data_protection_backup_vault' },
  { service: 'logic', armType: 'Microsoft.Logic/integrationAccounts', terraformType: 'azurerm_logic_app_integration_account' },
  { service: 'appconfiguration', armType: 'Microsoft.AppConfiguration/configurationStores', terraformType: 'azurerm_app_configuration' },

  // analytics
  { service: 'analytics', armType: 'Microsoft.Databricks/workspaces', terraformType: 'azurerm_databricks_workspace' },
  { service: 'analytics', armType: 'Microsoft.Synapse/workspaces', terraformType: 'azurerm_synapse_workspace' },
  { service: 'analytics', armType: 'Microsoft.Kusto/clusters', terraformType: 'azurerm_kusto_cluster' },
  { service: 'analytics', armType: 'Microsoft.StreamAnalytics/streamingJobs', terraformType: 'azurerm_stream_analytics_job' }
];

const BY_TYPE = new Map(ARM_MAPPINGS.map(mapping => [mapping.armType.toLowerCase(), mapping]));

/** Namespace (lowercase) -> the service that reports unmapped types of that namespace. */
const NAMESPACE_OWNERS = new Map<string, string>();
for (const mapping of ARM_MAPPINGS) {
  const namespace = mapping.armType.split('/')[0].toLowerCase();
  if (!NAMESPACE_OWNERS.has(namespace)) {
    NAMESPACE_OWNERS.set(namespace, mapping.service);
  }
}

/** Service that reports unmapped types whose namespace no service knows. */
export const FALLBACK_OWNER = 'resource_group';

export function findMapping(armType: string): ArmMapping | undefined {
  return BY_TYPE.get(armType.toLowerCase());
}

export function namespaceOwner(armType: string): string {
  return NAMESPACE_OWNERS.get(armType.split('/')[0].toLowerCase()) || FALLBACK_OWNER;
}

export function mappingsFor(service: string): ArmMapping[] {
  return ARM_MAPPINGS.filter(mapping => mapping.service === service);
}
