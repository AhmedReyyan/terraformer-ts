import { BaseService } from '../../../core/provider';
import { TerraformResource, ResourceFilter, ProviderConfig, Logger } from '../../../types';
import { EC2Client, DescribeInstancesCommand, DescribeVpcsCommand, DescribeSubnetsCommand, DescribeSecurityGroupsCommand } from '@aws-sdk/client-ec2';
import { fromIni } from '@aws-sdk/credential-providers';

export class EC2Service extends BaseService {
  private client: EC2Client;

  constructor(providerName: string, serviceName: string, config: ProviderConfig, logger: Logger) {
    super(providerName, serviceName, config, logger);
    this.client = new EC2Client({
      region: config.region || 'us-east-1',
      credentials: config.credentials ? {
        accessKeyId: config.credentials.accessKeyId || '',
        secretAccessKey: config.credentials.secretAccessKey || '',
        sessionToken: config.credentials.sessionToken || undefined
      } : undefined // Let AWS SDK use environment variables
    });
  }

  async initResources(): Promise<void> {
    await this.loadInstances();
    await this.loadVpcs();
    await this.loadSubnets();
    await this.loadSecurityGroups();
  }

  private async loadInstances(): Promise<void> {
    try {
      this.log('Loading EC2 instances...', 'info');
      
      const command = new DescribeInstancesCommand({});
      const response = await this.client.send(command);
      
      let instanceCount = 0;
      for (const reservation of response.Reservations || []) {
        for (const instance of reservation.Instances || []) {
          if (instance.InstanceId && instance.State?.Name !== 'terminated') {
            const resource = this.createResource(
              instance.InstanceId,
              this.generateInstanceName(instance),
              'instance',
              this.mapInstanceAttributes(instance),
              {
                tags: instance.Tags || []
              }
            );
            
            this.addResource(resource);
            instanceCount++;
          }
        }
      }
      
      this.log(`Loaded ${instanceCount} EC2 instances`, 'info');
    } catch (error) {
      this.log(`Error loading EC2 instances: ${error}`, 'error');
      throw error;
    }
  }

  private async loadVpcs(): Promise<void> {
    try {
      this.log('Loading VPCs...', 'info');
      
      const command = new DescribeVpcsCommand({});
      const response = await this.client.send(command);
      
      let vpcCount = 0;
      for (const vpc of response.Vpcs || []) {
        if (vpc.VpcId) {
          const resource = this.createResource(
            vpc.VpcId,
            this.generateVpcName(vpc),
            'vpc',
            this.mapVpcAttributes(vpc),
            {
              tags: vpc.Tags || []
            }
          );
          
          this.addResource(resource);
          vpcCount++;
        }
      }
      
      this.log(`Loaded ${vpcCount} VPCs`, 'info');
    } catch (error) {
      this.log(`Error loading VPCs: ${error}`, 'error');
      throw error;
    }
  }

  private async loadSubnets(): Promise<void> {
    try {
      this.log('Loading subnets...', 'info');
      
      const command = new DescribeSubnetsCommand({});
      const response = await this.client.send(command);
      
      let subnetCount = 0;
      for (const subnet of response.Subnets || []) {
        if (subnet.SubnetId) {
          const resource = this.createResource(
            subnet.SubnetId,
            this.generateSubnetName(subnet),
            'subnet',
            this.mapSubnetAttributes(subnet),
            {
              tags: subnet.Tags || []
            }
          );
          
          this.addResource(resource);
          subnetCount++;
        }
      }
      
      this.log(`Loaded ${subnetCount} subnets`, 'info');
    } catch (error) {
      this.log(`Error loading subnets: ${error}`, 'error');
      throw error;
    }
  }

  private async loadSecurityGroups(): Promise<void> {
    try {
      this.log('Loading security groups...', 'info');
      
      const command = new DescribeSecurityGroupsCommand({});
      const response = await this.client.send(command);
      
      let sgCount = 0;
      for (const sg of response.SecurityGroups || []) {
        if (sg.GroupId) {
          const resource = this.createResource(
            sg.GroupId,
            this.generateSecurityGroupName(sg),
            'security_group',
            this.mapSecurityGroupAttributes(sg),
            {
              tags: sg.Tags || []
            }
          );
          
          this.addResource(resource);
          sgCount++;
        }
      }
      
      this.log(`Loaded ${sgCount} security groups`, 'info');
    } catch (error) {
      this.log(`Error loading security groups: ${error}`, 'error');
      throw error;
    }
  }

  parseFilter(rawFilter: string): ResourceFilter[] {
    const filters: ResourceFilter[] = [];
    
    if (!rawFilter.includes('Name=') && rawFilter.includes('=')) {
      // Simple ID-based filter: resource=id1:id2:id3
      const [serviceName, resourcesId] = rawFilter.split('=');
      filters.push({
        serviceName,
        fieldPath: 'id',
        acceptableValues: resourcesId.split(':'),
        isApplicable: (resourceName: string) => serviceName === '' || serviceName === resourceName
      });
    } else {
      // Complex filter: Type=instance;Name=instance_type;Value=t3.micro
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
    // Post-processing hook for EC2 resources
    this.log('Running EC2 post-conversion hook...', 'debug');
  }

  private generateInstanceName(instance: any): string {
    const nameTag = instance.Tags?.find((tag: any) => tag.Key === 'Name')?.Value;
    return nameTag || `instance-${instance.InstanceId}`;
  }

  private generateVpcName(vpc: any): string {
    const nameTag = vpc.Tags?.find((tag: any) => tag.Key === 'Name')?.Value;
    return nameTag || `vpc-${vpc.VpcId}`;
  }

  private generateSubnetName(subnet: any): string {
    const nameTag = subnet.Tags?.find((tag: any) => tag.Key === 'Name')?.Value;
    return nameTag || `subnet-${subnet.SubnetId}`;
  }

  private generateSecurityGroupName(sg: any): string {
    const nameTag = sg.Tags?.find((tag: any) => tag.Key === 'Name')?.Value;
    return nameTag || sg.GroupName || `sg-${sg.GroupId}`;
  }

  private mapInstanceAttributes(instance: any): Record<string, any> {
    return {
      instance_type: instance.InstanceType,
      ami: instance.ImageId,
      availability_zone: instance.Placement?.AvailabilityZone,
      subnet_id: instance.SubnetId,
      vpc_security_group_ids: instance.SecurityGroups?.map((sg: any) => sg.GroupId) || [],
      key_name: instance.KeyName,
      monitoring: instance.Monitoring?.State === 'enabled',
      ebs_optimized: instance.EbsOptimized,
      disable_api_termination: instance.DisableApiTermination,
      instance_initiated_shutdown_behavior: instance.InstanceInitiatedShutdownBehavior,
      private_ip: instance.PrivateIpAddress,
      public_ip: instance.PublicIpAddress,
      associate_public_ip_address: instance.PublicIpAddress ? true : false,
      tenancy: instance.Placement?.Tenancy,
      host_id: instance.Placement?.HostId,
      cpu_core_count: instance.CpuOptions?.CoreCount,
      cpu_threads_per_core: instance.CpuOptions?.ThreadsPerCore,
      hibernation: instance.HibernationOptions?.Configured || false,
      enclave_options: instance.EnclaveOptions?.Enabled || false,
      metadata_options: {
        http_endpoint: instance.MetadataOptions?.HttpEndpoint,
        http_tokens: instance.MetadataOptions?.HttpTokens,
        http_put_response_hop_limit: instance.MetadataOptions?.HttpPutResponseHopLimit
      }
    };
  }

  private mapVpcAttributes(vpc: any): Record<string, any> {
    return {
      cidr_block: vpc.CidrBlock,
      instance_tenancy: vpc.InstanceTenancy,
      enable_dns_hostnames: vpc.DnsOptions?.DnsHostnames?.Value,
      enable_dns_support: vpc.DnsOptions?.DnsSupport?.Value,
      enable_classiclink: vpc.ClassicLinkEnabled,
      enable_classiclink_dns_support: vpc.ClassicLinkDnsSupported,
      assign_generated_ipv6_cidr_block: vpc.Ipv6CidrBlockAssociationSet?.length > 0
    };
  }

  private mapSubnetAttributes(subnet: any): Record<string, any> {
    return {
      vpc_id: subnet.VpcId,
      cidr_block: subnet.CidrBlock,
      availability_zone: subnet.AvailabilityZone,
      availability_zone_id: subnet.AvailabilityZoneId,
      map_public_ip_on_launch: subnet.MapPublicIpOnLaunch,
      assign_ipv6_address_on_creation: subnet.AssignIpv6AddressOnCreation,
      ipv6_cidr_block: subnet.Ipv6CidrBlockAssociationSet?.[0]?.Ipv6CidrBlock
    };
  }

  private mapSecurityGroupAttributes(sg: any): Record<string, any> {
    return {
      name: sg.GroupName,
      description: sg.Description,
      vpc_id: sg.VpcId,
      ingress: sg.IpPermissions?.map((rule: any) => ({
        from_port: rule.FromPort,
        to_port: rule.ToPort,
        protocol: rule.IpProtocol,
        cidr_blocks: rule.IpRanges?.map((ip: any) => ip.CidrIp) || [],
        ipv6_cidr_blocks: rule.Ipv6Ranges?.map((ip: any) => ip.CidrIpv6) || [],
        security_groups: rule.UserIdGroupPairs?.map((group: any) => group.GroupId) || [],
        self: rule.UserIdGroupPairs?.some((group: any) => group.UserId === sg.OwnerId) || false
      })) || [],
      egress: sg.IpPermissionsEgress?.map((rule: any) => ({
        from_port: rule.FromPort,
        to_port: rule.ToPort,
        protocol: rule.IpProtocol,
        cidr_blocks: rule.IpRanges?.map((ip: any) => ip.CidrIp) || [],
        ipv6_cidr_blocks: rule.Ipv6Ranges?.map((ip: any) => ip.CidrIpv6) || [],
        security_groups: rule.UserIdGroupPairs?.map((group: any) => group.GroupId) || [],
        self: rule.UserIdGroupPairs?.some((group: any) => group.UserId === sg.OwnerId) || false
      })) || []
    };
  }
}
