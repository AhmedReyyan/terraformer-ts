import { BaseService } from '../../../core/provider';
import { TerraformResource, ResourceFilter, ProviderConfig, Logger } from '../../../types';
import { 
  RDSClient, 
  DescribeDBClustersCommand, 
  DescribeDBClusterSnapshotsCommand,
  DescribeDBInstancesCommand,
  DescribeDBSnapshotsCommand,
  DescribeDBProxiesCommand,
  DescribeDBParameterGroupsCommand,
  DescribeDBSubnetGroupsCommand,
  DescribeOptionGroupsCommand,
  DescribeEventSubscriptionsCommand,
  DescribeGlobalClustersCommand
} from '@aws-sdk/client-rds';

export class RDSService extends BaseService {
  private client: RDSClient;

  constructor(providerName: string, serviceName: string, config: ProviderConfig, logger: Logger) {
    super(providerName, serviceName, config, logger);
    this.client = new RDSClient({
      region: config.region || 'us-east-1',
      credentials: config.credentials ? {
        accessKeyId: config.credentials.accessKeyId || '',
        secretAccessKey: config.credentials.secretAccessKey || '',
        sessionToken: config.credentials.sessionToken || undefined
      } : undefined
    });
  }

  async initResources(): Promise<void> {
    await this.loadDBClusters();
    await this.loadDBClusterSnapshots();
    await this.loadDBInstances();
    await this.loadDBInstanceSnapshots();
    await this.loadDBProxies();
    await this.loadDBParameterGroups();
    await this.loadDBSubnetGroups();
    await this.loadOptionGroups();
    await this.loadEventSubscriptions();
    await this.loadGlobalClusters();
  }

  parseFilter(rawFilter: string): ResourceFilter[] {
    const filters: ResourceFilter[] = [];
    
    if (!rawFilter.includes('Name=') && rawFilter.includes('=')) {
      const [serviceName, resourcesId] = rawFilter.split('=');
      filters.push({
        serviceName,
        fieldPath: 'id',
        acceptableValues: resourcesId.split(':'),
        isApplicable: (resourceName: string) => serviceName === '' || serviceName === resourceName
      });
    } else {
      const parts = rawFilter.split(';');
      if (parts.length >= 1) {
        const serviceName = parts[0].startsWith('Type=') ? parts[0].substring(5) : '';
        const fieldPath = parts[1]?.startsWith('Name=') ? parts[1].substring(5) : parts[0];
        const acceptableValues = parts[2]?.startsWith('Value=') ? 
          parts[2].substring(6).split(':') : undefined;

        filters.push({
          serviceName,
          fieldPath,
          acceptableValues: acceptableValues || [],
          isApplicable: (resourceName: string) => serviceName === '' || serviceName === resourceName
        });
      }
    }

    return filters;
  }

  async postConvertHook(): Promise<void> {
    this.log('Running RDS post-conversion hook...', 'debug');
  }

  private async loadDBClusters(): Promise<void> {
    try {
      this.log('Loading RDS DB clusters...', 'info');
      
      const command = new DescribeDBClustersCommand({});
      const response = await this.client.send(command);
      
      let clusterCount = 0;
      for (const cluster of response.DBClusters || []) {
        if (cluster.DBClusterIdentifier) {
          const resource = this.createResource(
            cluster.DBClusterIdentifier,
            cluster.DBClusterIdentifier,
            'rds_cluster',
            {},
            {
              cluster_identifier: cluster.DBClusterIdentifier,
              engine: cluster.Engine,
              engine_version: cluster.EngineVersion,
              database_name: cluster.DatabaseName,
              master_username: cluster.MasterUsername,
              port: cluster.Port,
              backup_retention_period: cluster.BackupRetentionPeriod,
              preferred_backup_window: cluster.PreferredBackupWindow,
              preferred_maintenance_window: cluster.PreferredMaintenanceWindow,
              vpc_security_group_ids: cluster.VpcSecurityGroups?.map(sg => sg.VpcSecurityGroupId) || [],
              db_subnet_group_name: cluster.DBSubnetGroup,
              db_cluster_parameter_group_name: cluster.DBClusterParameterGroup,
              availability_zones: cluster.AvailabilityZones || [],
              storage_encrypted: cluster.StorageEncrypted,
              kms_key_id: cluster.KmsKeyId,
              deletion_protection: cluster.DeletionProtection,
              enabled_cloudwatch_logs_exports: cluster.EnabledCloudwatchLogsExports || []
            }
          );
          
          this.addResource(resource);
          clusterCount++;
        }
      }
      
      this.log(`Loaded ${clusterCount} RDS DB clusters`, 'info');
    } catch (error) {
      this.log(`Error loading RDS DB clusters: ${error}`, 'error');
      throw error;
    }
  }

  private async loadDBClusterSnapshots(): Promise<void> {
    try {
      this.log('Loading RDS DB cluster snapshots...', 'info');
      
      const command = new DescribeDBClusterSnapshotsCommand({});
      const response = await this.client.send(command);
      
      let snapshotCount = 0;
      for (const snapshot of response.DBClusterSnapshots || []) {
        if (snapshot.DBClusterSnapshotIdentifier) {
          const resource = this.createResource(
            snapshot.DBClusterSnapshotIdentifier,
            snapshot.DBClusterSnapshotIdentifier,
            'db_cluster_snapshot',
            {},
            {
              db_cluster_snapshot_identifier: snapshot.DBClusterSnapshotIdentifier,
              db_cluster_identifier: snapshot.DBClusterIdentifier,
              snapshot_type: snapshot.SnapshotType,
              status: snapshot.Status,
              percent_progress: snapshot.PercentProgress,
              storage_encrypted: snapshot.StorageEncrypted,
              kms_key_id: snapshot.KmsKeyId,
              snapshot_create_time: snapshot.SnapshotCreateTime
            }
          );
          
          this.addResource(resource);
          snapshotCount++;
        }
      }
      
      this.log(`Loaded ${snapshotCount} RDS DB cluster snapshots`, 'info');
    } catch (error) {
      this.log(`Error loading RDS DB cluster snapshots: ${error}`, 'error');
      throw error;
    }
  }

  private async loadDBInstances(): Promise<void> {
    try {
      this.log('Loading RDS DB instances...', 'info');
      
      const command = new DescribeDBInstancesCommand({});
      const response = await this.client.send(command);
      
      let instanceCount = 0;
      for (const instance of response.DBInstances || []) {
        if (instance.DBInstanceIdentifier) {
          const resource = this.createResource(
            instance.DBInstanceIdentifier,
            instance.DBInstanceIdentifier,
            'db_instance',
            {},
            {
              identifier: instance.DBInstanceIdentifier,
              engine: instance.Engine,
              engine_version: instance.EngineVersion,
              instance_class: instance.DBInstanceClass,
              allocated_storage: instance.AllocatedStorage,
              storage_type: instance.StorageType,
              storage_encrypted: instance.StorageEncrypted,
              kms_key_id: instance.KmsKeyId,
              db_name: instance.DBName,
              master_username: instance.MasterUsername,
              port: instance.DbInstancePort,
              vpc_security_group_ids: instance.VpcSecurityGroups?.map(sg => sg.VpcSecurityGroupId) || [],
              db_subnet_group_name: instance.DBSubnetGroup?.DBSubnetGroupName,
              parameter_group_name: instance.DBParameterGroups?.[0]?.DBParameterGroupName,
              option_group_name: instance.OptionGroupMemberships?.[0]?.OptionGroupName,
              availability_zone: instance.AvailabilityZone,
              multi_az: instance.MultiAZ,
              publicly_accessible: instance.PubliclyAccessible,
              backup_retention_period: instance.BackupRetentionPeriod,
              backup_window: instance.PreferredBackupWindow,
              maintenance_window: instance.PreferredMaintenanceWindow,
              auto_minor_version_upgrade: instance.AutoMinorVersionUpgrade,
              deletion_protection: instance.DeletionProtection,
              performance_insights_enabled: instance.PerformanceInsightsEnabled,
              performance_insights_kms_key_id: instance.PerformanceInsightsKMSKeyId,
              monitoring_interval: instance.MonitoringInterval,
              monitoring_role_arn: instance.MonitoringRoleArn,
              enabled_cloudwatch_logs_exports: instance.EnabledCloudwatchLogsExports || []
            }
          );
          
          this.addResource(resource);
          instanceCount++;
        }
      }
      
      this.log(`Loaded ${instanceCount} RDS DB instances`, 'info');
    } catch (error) {
      this.log(`Error loading RDS DB instances: ${error}`, 'error');
      throw error;
    }
  }

  private async loadDBInstanceSnapshots(): Promise<void> {
    try {
      this.log('Loading RDS DB instance snapshots...', 'info');
      
      const command = new DescribeDBSnapshotsCommand({});
      const response = await this.client.send(command);
      
      let snapshotCount = 0;
      for (const snapshot of response.DBSnapshots || []) {
        if (snapshot.DBSnapshotIdentifier) {
          const resource = this.createResource(
            snapshot.DBSnapshotIdentifier,
            snapshot.DBSnapshotIdentifier,
            'db_snapshot',
            {},
            {
              db_snapshot_identifier: snapshot.DBSnapshotIdentifier,
              db_instance_identifier: snapshot.DBInstanceIdentifier,
              snapshot_type: snapshot.SnapshotType,
              status: snapshot.Status,
              percent_progress: snapshot.PercentProgress,
              storage_type: snapshot.StorageType,
              storage_encrypted: snapshot.Encrypted,
              kms_key_id: snapshot.KmsKeyId,
              snapshot_create_time: snapshot.SnapshotCreateTime,
              allocated_storage: snapshot.AllocatedStorage,
              engine: snapshot.Engine,
              engine_version: snapshot.EngineVersion,
              license_model: snapshot.LicenseModel,
              iops: snapshot.Iops,
              option_group_name: snapshot.OptionGroupName,
              port: snapshot.Port,
              availability_zone: snapshot.AvailabilityZone,
              vpc_id: snapshot.VpcId
            }
          );
          
          this.addResource(resource);
          snapshotCount++;
        }
      }
      
      this.log(`Loaded ${snapshotCount} RDS DB instance snapshots`, 'info');
    } catch (error) {
      this.log(`Error loading RDS DB instance snapshots: ${error}`, 'error');
      throw error;
    }
  }

  private async loadDBProxies(): Promise<void> {
    try {
      this.log('Loading RDS DB proxies...', 'info');
      
      const command = new DescribeDBProxiesCommand({});
      const response = await this.client.send(command);
      
      let proxyCount = 0;
      for (const proxy of response.DBProxies || []) {
        if (proxy.DBProxyName) {
          const resource = this.createResource(
            proxy.DBProxyName,
            proxy.DBProxyName,
            'db_proxy',
            {},
            {
              name: proxy.DBProxyName,
              engine_family: proxy.EngineFamily,
              auth: proxy.Auth?.map(auth => ({
                auth_scheme: auth.AuthScheme,
                description: auth.Description,
                iam_auth: auth.IAMAuth,
                secret_arn: auth.SecretArn,
                username: auth.UserName
              })) || [],
              role_arn: proxy.RoleArn,
              vpc_subnet_ids: proxy.VpcSubnetIds || [],
              require_tls: proxy.RequireTLS,
              idle_client_timeout: proxy.IdleClientTimeout,
              debug_logging: proxy.DebugLogging
            }
          );
          
          this.addResource(resource);
          proxyCount++;
        }
      }
      
      this.log(`Loaded ${proxyCount} RDS DB proxies`, 'info');
    } catch (error) {
      this.log(`Error loading RDS DB proxies: ${error}`, 'error');
      throw error;
    }
  }

  private async loadDBParameterGroups(): Promise<void> {
    try {
      this.log('Loading RDS DB parameter groups...', 'info');
      
      const command = new DescribeDBParameterGroupsCommand({});
      const response = await this.client.send(command);
      
      let groupCount = 0;
      for (const group of response.DBParameterGroups || []) {
        if (group.DBParameterGroupName && !group.DBParameterGroupName.includes('.')) {
          // Skip default parameter groups
          const resource = this.createResource(
            group.DBParameterGroupName,
            group.DBParameterGroupName,
            'db_parameter_group',
            {},
            {
              name: group.DBParameterGroupName,
              family: group.DBParameterGroupFamily,
              description: group.Description
            }
          );
          
          this.addResource(resource);
          groupCount++;
        }
      }
      
      this.log(`Loaded ${groupCount} RDS DB parameter groups`, 'info');
    } catch (error) {
      this.log(`Error loading RDS DB parameter groups: ${error}`, 'error');
      throw error;
    }
  }

  private async loadDBSubnetGroups(): Promise<void> {
    try {
      this.log('Loading RDS DB subnet groups...', 'info');
      
      const command = new DescribeDBSubnetGroupsCommand({});
      const response = await this.client.send(command);
      
      let groupCount = 0;
      for (const group of response.DBSubnetGroups || []) {
        if (group.DBSubnetGroupName) {
          const resource = this.createResource(
            group.DBSubnetGroupName,
            group.DBSubnetGroupName,
            'db_subnet_group',
            {},
            {
              name: group.DBSubnetGroupName,
              description: group.DBSubnetGroupDescription,
              subnet_ids: group.Subnets?.map(subnet => subnet.SubnetIdentifier) || [],
              vpc_id: group.VpcId
            }
          );
          
          this.addResource(resource);
          groupCount++;
        }
      }
      
      this.log(`Loaded ${groupCount} RDS DB subnet groups`, 'info');
    } catch (error) {
      this.log(`Error loading RDS DB subnet groups: ${error}`, 'error');
      throw error;
    }
  }

  private async loadOptionGroups(): Promise<void> {
    try {
      this.log('Loading RDS option groups...', 'info');
      
      const command = new DescribeOptionGroupsCommand({});
      const response = await this.client.send(command);
      
      let groupCount = 0;
      for (const group of response.OptionGroupsList || []) {
        if (group.OptionGroupName && !group.OptionGroupName.includes('.') && !group.OptionGroupName.includes(':')) {
          // Skip default option groups
          const resource = this.createResource(
            group.OptionGroupName,
            group.OptionGroupName,
            'db_option_group',
            {},
            {
              name: group.OptionGroupName,
              option_group_description: group.OptionGroupDescription,
              engine_name: group.EngineName,
              major_engine_version: group.MajorEngineVersion
            }
          );
          
          this.addResource(resource);
          groupCount++;
        }
      }
      
      this.log(`Loaded ${groupCount} RDS option groups`, 'info');
    } catch (error) {
      this.log(`Error loading RDS option groups: ${error}`, 'error');
      throw error;
    }
  }

  private async loadEventSubscriptions(): Promise<void> {
    try {
      this.log('Loading RDS event subscriptions...', 'info');
      
      const command = new DescribeEventSubscriptionsCommand({});
      const response = await this.client.send(command);
      
      let subscriptionCount = 0;
      for (const subscription of response.EventSubscriptionsList || []) {
        if (subscription.CustomerAwsId) {
          const resource = this.createResource(
            subscription.CustomerAwsId,
            subscription.CustomerAwsId,
            'db_event_subscription',
            {},
            {
              name: subscription.CustSubscriptionId,
              sns_topic: subscription.SnsTopicArn,
              source_type: subscription.SourceType,
              source_ids: subscription.SourceIdsList || [],
              event_categories: subscription.EventCategoriesList || [],
              enabled: subscription.Enabled
            }
          );
          
          this.addResource(resource);
          subscriptionCount++;
        }
      }
      
      this.log(`Loaded ${subscriptionCount} RDS event subscriptions`, 'info');
    } catch (error) {
      this.log(`Error loading RDS event subscriptions: ${error}`, 'error');
      throw error;
    }
  }

  private async loadGlobalClusters(): Promise<void> {
    try {
      this.log('Loading RDS global clusters...', 'info');
      
      const command = new DescribeGlobalClustersCommand({});
      const response = await this.client.send(command);
      
      let clusterCount = 0;
      for (const cluster of response.GlobalClusters || []) {
        if (cluster.GlobalClusterIdentifier) {
          const resource = this.createResource(
            cluster.GlobalClusterIdentifier,
            cluster.GlobalClusterIdentifier,
            'rds_global_cluster',
            {},
            {
              global_cluster_identifier: cluster.GlobalClusterIdentifier,
              engine: cluster.Engine,
              engine_version: cluster.EngineVersion,
              database_name: cluster.DatabaseName,
              deletion_protection: cluster.DeletionProtection,
              storage_encrypted: cluster.StorageEncrypted
            }
          );
          
          this.addResource(resource);
          clusterCount++;
        }
      }
      
      this.log(`Loaded ${clusterCount} RDS global clusters`, 'info');
    } catch (error) {
      this.log(`Error loading RDS global clusters: ${error}`, 'error');
      throw error;
    }
  }
}

