import { BaseService } from '../../../core/provider';
import { TerraformResource, ResourceFilter, ProviderConfig, Logger } from '../../../types';
import { 
  EC2Client, 
  DescribeInstancesCommand, 
  DescribeInstancesCommandOutput,
  DescribeInstanceAttributeCommand,
  DescribeVolumesCommand,
  DescribeNetworkInterfacesCommand,
  DescribeImagesCommand,
  DescribeSnapshotsCommand,
  DescribeKeyPairsCommand,
  DescribeSecurityGroupsCommand,
  DescribeVpcsCommand,
  DescribeSubnetsCommand,
  DescribeRouteTablesCommand,
  DescribeInternetGatewaysCommand,
  DescribeNatGatewaysCommand,
  DescribeVpcEndpointsCommand,
  DescribeVpcPeeringConnectionsCommand,
  DescribeVpnConnectionsCommand,
  DescribeVpnGatewaysCommand,
  DescribeCustomerGatewaysCommand,
  DescribeTransitGatewaysCommand,
  DescribeTransitGatewayVpcAttachmentsCommand,
  DescribeTransitGatewayRouteTablesCommand,
  DescribeTransitGatewayAttachmentsCommand,
  InstanceAttributeName,
  InstanceStateName
} from '@aws-sdk/client-ec2';
import { fromIni } from '@aws-sdk/credential-providers';

export class EC2CompleteService extends BaseService {
  private client: EC2Client;

  constructor(providerName: string, serviceName: string, config: ProviderConfig, logger: Logger) {
    super(providerName, serviceName, config, logger);
    this.client = new EC2Client({
      region: config.region || 'us-east-1',
      credentials: config.credentials ? {
        accessKeyId: config.credentials.accessKeyId || '',
        secretAccessKey: config.credentials.secretAccessKey || '',
        sessionToken: config.credentials.sessionToken || undefined
      } : undefined
    });
  }

  async initResources(): Promise<void> {
    await this.loadInstances();
    await this.loadVolumes();
    await this.loadNetworkInterfaces();
    await this.loadKeyPairs();
    await this.loadSnapshots();
    await this.loadImages();
    await this.loadVpcs();
    await this.loadSubnets();
    await this.loadSecurityGroups();
    await this.loadRouteTables();
    await this.loadInternetGateways();
    await this.loadNatGateways();
    await this.loadVpcEndpoints();
    await this.loadVpcPeeringConnections();
    await this.loadVpnConnections();
    await this.loadVpnGateways();
    await this.loadCustomerGateways();
    await this.loadTransitGateways();
  }

  private async loadInstances(): Promise<void> {
    try {
      this.log('Loading EC2 instances with complete details...', 'info');
      
      const command = new DescribeInstancesCommand({});
      const response = await this.client.send(command);
      
      let instanceCount = 0;
      for (const reservation of response.Reservations || []) {
        for (const instance of reservation.Instances || []) {
          if (instance.InstanceId && instance.State?.Name !== InstanceStateName.terminated) {
            // Get complete instance details
            const instanceDetails = await this.getCompleteInstanceDetails(instance);
            
            const resource = this.createResource(
              instance.InstanceId,
              this.generateInstanceName(instance),
              'instance',
              instanceDetails.attributes,
              instanceDetails.additionalFields
            );
            
            this.addResource(resource);
            instanceCount++;
          }
        }
      }
      
      this.log(`Loaded ${instanceCount} EC2 instances with complete details`, 'info');
    } catch (error) {
      this.log(`Error loading EC2 instances: ${error}`, 'error');
      throw error;
    }
  }

  private async getCompleteInstanceDetails(instance: any): Promise<{
    attributes: Record<string, any>;
    additionalFields: Record<string, any>;
  }> {
    const attributes: Record<string, any> = {};
    const additionalFields: Record<string, any> = {};

    // Basic instance attributes
    attributes.instance_type = instance.InstanceType;
    attributes.ami = instance.ImageId;
    attributes.availability_zone = instance.Placement?.AvailabilityZone;
    attributes.subnet_id = instance.SubnetId;
    attributes.vpc_id = instance.VpcId;
    attributes.key_name = instance.KeyName;
    attributes.monitoring = instance.Monitoring?.State === 'enabled';
    attributes.ebs_optimized = instance.EbsOptimized;
    attributes.disable_api_termination = instance.DisableApiTermination;
    attributes.instance_initiated_shutdown_behavior = instance.InstanceInitiatedShutdownBehavior;
    attributes.private_ip = instance.PrivateIpAddress;
    attributes.public_ip = instance.PublicIpAddress;
    attributes.associate_public_ip_address = instance.PublicIpAddress ? true : false;
    attributes.tenancy = instance.Placement?.Tenancy;
    attributes.host_id = instance.Placement?.HostId;
    attributes.cpu_core_count = instance.CpuOptions?.CoreCount;
    attributes.cpu_threads_per_core = instance.CpuOptions?.ThreadsPerCore;
    attributes.hibernation = instance.HibernationOptions?.Configured || false;
    attributes.enclave_options = instance.EnclaveOptions?.Enabled || false;
    attributes.source_dest_check = true; // Default value

    // Get user data
    try {
      const userDataCommand = new DescribeInstanceAttributeCommand({
        InstanceId: instance.InstanceId,
        Attribute: InstanceAttributeName.userData
      });
      const userDataResponse = await this.client.send(userDataCommand);
      if (userDataResponse.UserData?.Value) {
        attributes.user_data_base64 = userDataResponse.UserData.Value;
      }
    } catch (error) {
      this.log(`Could not fetch user data for instance ${instance.InstanceId}: ${error}`, 'debug');
    }

    // Security groups
    attributes.vpc_security_group_ids = instance.SecurityGroups?.map((sg: any) => sg.GroupId) || [];

    // Network interfaces
    if (instance.NetworkInterfaces) {
      attributes.network_interface = instance.NetworkInterfaces.map((ni: any) => ({
        network_interface_id: ni.NetworkInterfaceId,
        device_index: ni.Attachment?.DeviceIndex,
        delete_on_termination: ni.Attachment?.DeleteOnTermination,
        network_card_index: ni.Attachment?.NetworkCardIndex
      }));
    }

    // IAM instance profile
    if (instance.IamInstanceProfile) {
      attributes.iam_instance_profile = {
        name: instance.IamInstanceProfile.Arn?.split('/').pop(),
        arn: instance.IamInstanceProfile.Arn
      };
    }

    // Root device
    if (instance.RootDeviceName) {
      attributes.root_block_device = {
        device_name: instance.RootDeviceName,
        volume_type: instance.RootDeviceType,
        delete_on_termination: true
      };
    }

    // EBS block devices
    if (instance.BlockDeviceMappings) {
      attributes.ebs_block_device = instance.BlockDeviceMappings
        .filter((bdm: any) => bdm.Ebs)
        .map((bdm: any) => ({
          device_name: bdm.DeviceName,
          volume_id: bdm.Ebs.VolumeId,
          delete_on_termination: bdm.Ebs.DeleteOnTermination
        }));
    }

    // Metadata options
    if (instance.MetadataOptions) {
      attributes.metadata_options = {
        http_endpoint: instance.MetadataOptions.HttpEndpoint,
        http_tokens: instance.MetadataOptions.HttpTokens,
        http_put_response_hop_limit: instance.MetadataOptions.HttpPutResponseHopLimit,
        instance_metadata_tags: instance.MetadataOptions.InstanceMetadataTags
      };
    }

    // Tags
    if (instance.Tags) {
      attributes.tags = instance.Tags.reduce((acc: any, tag: any) => {
        acc[tag.Key] = tag.Value;
        return acc;
      }, {});
    }

    // Additional fields for complex data
    additionalFields.state = instance.State?.Name;
    additionalFields.state_reason = instance.StateReason;
    additionalFields.launch_time = instance.LaunchTime;
    additionalFields.architecture = instance.Architecture;
    additionalFields.virtualization_type = instance.VirtualizationType;
    additionalFields.hypervisor = instance.Hypervisor;
    additionalFields.platform = instance.Platform;
    additionalFields.ram_disk_id = instance.RamDiskId;
    additionalFields.ramdisk_id = instance.RamdiskId;
    additionalFields.source_dest_check = instance.SourceDestCheck;

    return { attributes, additionalFields };
  }

  private async loadVolumes(): Promise<void> {
    try {
      this.log('Loading EBS volumes...', 'info');
      
      const command = new DescribeVolumesCommand({});
      const response = await this.client.send(command);
      
      let volumeCount = 0;
      for (const volume of response.Volumes || []) {
        if (volume.VolumeId) {
          const resource = this.createResource(
            volume.VolumeId,
            this.generateVolumeName(volume),
            'ebs_volume',
            this.mapVolumeAttributes(volume),
            {
              tags: volume.Tags || [],
              attachments: volume.Attachments || []
            }
          );
          
          this.addResource(resource);
          volumeCount++;
        }
      }
      
      this.log(`Loaded ${volumeCount} EBS volumes`, 'info');
    } catch (error) {
      this.log(`Error loading EBS volumes: ${error}`, 'error');
      throw error;
    }
  }

  private async loadNetworkInterfaces(): Promise<void> {
    try {
      this.log('Loading network interfaces...', 'info');
      
      const command = new DescribeNetworkInterfacesCommand({});
      const response = await this.client.send(command);
      
      let eniCount = 0;
      for (const eni of response.NetworkInterfaces || []) {
        if (eni.NetworkInterfaceId) {
          const resource = this.createResource(
            eni.NetworkInterfaceId,
            this.generateNetworkInterfaceName(eni),
            'network_interface',
            this.mapNetworkInterfaceAttributes(eni),
            {
              tags: eni.TagSet || []
            }
          );
          
          this.addResource(resource);
          eniCount++;
        }
      }
      
      this.log(`Loaded ${eniCount} network interfaces`, 'info');
    } catch (error) {
      this.log(`Error loading network interfaces: ${error}`, 'error');
      throw error;
    }
  }

  private async loadKeyPairs(): Promise<void> {
    try {
      this.log('Loading key pairs...', 'info');
      
      const command = new DescribeKeyPairsCommand({});
      const response = await this.client.send(command);
      
      let keyCount = 0;
      for (const keyPair of response.KeyPairs || []) {
        if (keyPair.KeyPairId) {
          const resource = this.createResource(
            keyPair.KeyPairId,
            keyPair.KeyName || keyPair.KeyPairId,
            'key_pair',
            {
              key_name: keyPair.KeyName,
              key_pair_id: keyPair.KeyPairId,
              fingerprint: keyPair.KeyFingerprint,
              public_key: keyPair.PublicKey
            },
            {
              tags: keyPair.Tags || []
            }
          );
          
          this.addResource(resource);
          keyCount++;
        }
      }
      
      this.log(`Loaded ${keyCount} key pairs`, 'info');
    } catch (error) {
      this.log(`Error loading key pairs: ${error}`, 'error');
      throw error;
    }
  }

  private async loadSnapshots(): Promise<void> {
    try {
      this.log('Loading EBS snapshots...', 'info');
      
      const command = new DescribeSnapshotsCommand({
        OwnerIds: ['self']
      });
      const response = await this.client.send(command);
      
      let snapshotCount = 0;
      for (const snapshot of response.Snapshots || []) {
        if (snapshot.SnapshotId) {
          const resource = this.createResource(
            snapshot.SnapshotId,
            this.generateSnapshotName(snapshot),
            'ebs_snapshot',
            this.mapSnapshotAttributes(snapshot),
            {
              tags: snapshot.Tags || []
            }
          );
          
          this.addResource(resource);
          snapshotCount++;
        }
      }
      
      this.log(`Loaded ${snapshotCount} EBS snapshots`, 'info');
    } catch (error) {
      this.log(`Error loading EBS snapshots: ${error}`, 'error');
      throw error;
    }
  }

  private async loadImages(): Promise<void> {
    try {
      this.log('Loading AMI images...', 'info');
      
      const command = new DescribeImagesCommand({
        Owners: ['self']
      });
      const response = await this.client.send(command);
      
      let imageCount = 0;
      for (const image of response.Images || []) {
        if (image.ImageId) {
          const resource = this.createResource(
            image.ImageId,
            this.generateImageName(image),
            'ami',
            this.mapImageAttributes(image),
            {
              tags: image.Tags || []
            }
          );
          
          this.addResource(resource);
          imageCount++;
        }
      }
      
      this.log(`Loaded ${imageCount} AMI images`, 'info');
    } catch (error) {
      this.log(`Error loading AMI images: ${error}`, 'error');
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
            {
              cidr_block: vpc.CidrBlock,
              instance_tenancy: vpc.InstanceTenancy,
              enable_dns_hostnames: vpc.DhcpOptionsId ? true : false,
              enable_dns_support: vpc.DhcpOptionsId ? true : false,
              tags: this.convertTags(vpc.Tags),
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
      this.log('Loading Subnets...', 'info');
      
      const command = new DescribeSubnetsCommand({});
      const response = await this.client.send(command);
      
      let subnetCount = 0;
      for (const subnet of response.Subnets || []) {
        if (subnet.SubnetId) {
          const resource = this.createResource(
            subnet.SubnetId,
            this.generateSubnetName(subnet),
            'subnet',
            {
              vpc_id: subnet.VpcId,
              cidr_block: subnet.CidrBlock,
              availability_zone: subnet.AvailabilityZone,
              map_public_ip_on_launch: subnet.MapPublicIpOnLaunch,
              tags: this.convertTags(subnet.Tags),
            }
          );
          
          this.addResource(resource);
          subnetCount++;
        }
      }
      
      this.log(`Loaded ${subnetCount} Subnets`, 'info');
    } catch (error) {
      this.log(`Error loading Subnets: ${error}`, 'error');
      throw error;
    }
  }

  private async loadSecurityGroups(): Promise<void> {
    try {
      this.log('Loading Security Groups...', 'info');
      
      const command = new DescribeSecurityGroupsCommand({});
      const response = await this.client.send(command);
      
      let sgCount = 0;
      for (const sg of response.SecurityGroups || []) {
        if (sg.GroupId) {
          const resource = this.createResource(
            sg.GroupId,
            this.generateSecurityGroupName(sg),
            'security_group',
            {
              vpc_id: sg.VpcId,
              name: sg.GroupName,
              description: sg.Description,
              ingress: this.mapIpPermissions(sg.IpPermissions),
              egress: this.mapIpPermissions(sg.IpPermissionsEgress),
              tags: this.convertTags(sg.Tags),
            }
          );
          
          this.addResource(resource);
          sgCount++;
        }
      }
      
      this.log(`Loaded ${sgCount} Security Groups`, 'info');
    } catch (error) {
      this.log(`Error loading Security Groups: ${error}`, 'error');
      throw error;
    }
  }

  private async loadRouteTables(): Promise<void> {
    try {
      this.log('Loading Route Tables...', 'info');
      
      const command = new DescribeRouteTablesCommand({});
      const response = await this.client.send(command);
      
      let rtCount = 0;
      for (const rt of response.RouteTables || []) {
        if (rt.RouteTableId) {
          const resource = this.createResource(
            rt.RouteTableId,
            this.generateRouteTableName(rt),
            'route_table',
            {
              vpc_id: rt.VpcId,
              routes: this.mapRoutes(rt.Routes),
              tags: this.convertTags(rt.Tags),
            }
          );
          
          this.addResource(resource);
          rtCount++;
        }
      }
      
      this.log(`Loaded ${rtCount} Route Tables`, 'info');
    } catch (error) {
      this.log(`Error loading Route Tables: ${error}`, 'error');
      throw error;
    }
  }

  private async loadInternetGateways(): Promise<void> {
    try {
      this.log('Loading Internet Gateways...', 'info');
      
      const command = new DescribeInternetGatewaysCommand({});
      const response = await this.client.send(command);
      
      let igwCount = 0;
      for (const igw of response.InternetGateways || []) {
        if (igw.InternetGatewayId) {
          const resource = this.createResource(
            igw.InternetGatewayId,
            this.generateInternetGatewayName(igw),
            'internet_gateway',
            {
              vpc_id: igw.Attachments?.[0]?.VpcId,
              tags: this.convertTags(igw.Tags),
            }
          );
          
          this.addResource(resource);
          igwCount++;
        }
      }
      
      this.log(`Loaded ${igwCount} Internet Gateways`, 'info');
    } catch (error) {
      this.log(`Error loading Internet Gateways: ${error}`, 'error');
      throw error;
    }
  }

  private async loadNatGateways(): Promise<void> {
    try {
      this.log('Loading NAT Gateways...', 'info');
      
      const command = new DescribeNatGatewaysCommand({});
      const response = await this.client.send(command);
      
      let natCount = 0;
      for (const nat of response.NatGateways || []) {
        if (nat.NatGatewayId) {
          const resource = this.createResource(
            nat.NatGatewayId,
            this.generateNatGatewayName(nat),
            'nat_gateway',
            {
              subnet_id: nat.SubnetId,
              allocation_id: nat.NatGatewayAddresses?.[0]?.AllocationId,
              public_ip: nat.NatGatewayAddresses?.[0]?.PublicIp,
              private_ip: nat.NatGatewayAddresses?.[0]?.PrivateIp,
              tags: this.convertTags(nat.Tags),
            }
          );
          
          this.addResource(resource);
          natCount++;
        }
      }
      
      this.log(`Loaded ${natCount} NAT Gateways`, 'info');
    } catch (error) {
      this.log(`Error loading NAT Gateways: ${error}`, 'error');
      throw error;
    }
  }

  private async loadVpcEndpoints(): Promise<void> {
    try {
      this.log('Loading VPC Endpoints...', 'info');
      
      const command = new DescribeVpcEndpointsCommand({});
      const response = await this.client.send(command);
      
      let endpointCount = 0;
      for (const endpoint of response.VpcEndpoints || []) {
        if (endpoint.VpcEndpointId) {
          const resource = this.createResource(
            endpoint.VpcEndpointId,
            this.generateVpcEndpointName(endpoint),
            'vpc_endpoint',
            {
              vpc_id: endpoint.VpcId,
              service_name: endpoint.ServiceName,
              vpc_endpoint_type: endpoint.VpcEndpointType,
              subnet_ids: endpoint.SubnetIds,
              security_group_ids: endpoint.Groups?.map(g => g.GroupId),
              private_dns_enabled: endpoint.PrivateDnsEnabled,
              tags: this.convertTags(endpoint.Tags),
            }
          );
          
          this.addResource(resource);
          endpointCount++;
        }
      }
      
      this.log(`Loaded ${endpointCount} VPC Endpoints`, 'info');
    } catch (error) {
      this.log(`Error loading VPC Endpoints: ${error}`, 'error');
      throw error;
    }
  }

  private async loadVpcPeeringConnections(): Promise<void> {
    try {
      this.log('Loading VPC Peering Connections...', 'info');
      
      const command = new DescribeVpcPeeringConnectionsCommand({});
      const response = await this.client.send(command);
      
      let peeringCount = 0;
      for (const peering of response.VpcPeeringConnections || []) {
        if (peering.VpcPeeringConnectionId) {
          const resource = this.createResource(
            peering.VpcPeeringConnectionId,
            this.generateVpcPeeringConnectionName(peering),
            'vpc_peering_connection',
            {
              peer_vpc_id: peering.AccepterVpcInfo?.VpcId,
              vpc_id: peering.RequesterVpcInfo?.VpcId,
              auto_accept: peering.Status?.Code === 'active',
              tags: this.convertTags(peering.Tags),
            }
          );
          
          this.addResource(resource);
          peeringCount++;
        }
      }
      
      this.log(`Loaded ${peeringCount} VPC Peering Connections`, 'info');
    } catch (error) {
      this.log(`Error loading VPC Peering Connections: ${error}`, 'error');
      throw error;
    }
  }

  private async loadVpnConnections(): Promise<void> {
    try {
      this.log('Loading VPN Connections...', 'info');
      
      const command = new DescribeVpnConnectionsCommand({});
      const response = await this.client.send(command);
      
      let vpnCount = 0;
      for (const vpn of response.VpnConnections || []) {
        if (vpn.VpnConnectionId) {
          const resource = this.createResource(
            vpn.VpnConnectionId,
            this.generateVpnConnectionName(vpn),
            'vpn_connection',
            {
              customer_gateway_id: vpn.CustomerGatewayId,
              vpn_gateway_id: vpn.VpnGatewayId,
              transit_gateway_id: vpn.TransitGatewayId,
              type: vpn.Type,
              static_routes_only: vpn.Options?.StaticRoutesOnly,
              tags: this.convertTags(vpn.Tags),
            }
          );
          
          this.addResource(resource);
          vpnCount++;
        }
      }
      
      this.log(`Loaded ${vpnCount} VPN Connections`, 'info');
    } catch (error) {
      this.log(`Error loading VPN Connections: ${error}`, 'error');
      throw error;
    }
  }

  private async loadVpnGateways(): Promise<void> {
    try {
      this.log('Loading VPN Gateways...', 'info');
      
      const command = new DescribeVpnGatewaysCommand({});
      const response = await this.client.send(command);
      
      let vgwCount = 0;
      for (const vgw of response.VpnGateways || []) {
        if (vgw.VpnGatewayId) {
          const resource = this.createResource(
            vgw.VpnGatewayId,
            this.generateVpnGatewayName(vgw),
            'vpn_gateway',
            {
              type: vgw.Type,
              amazon_side_asn: vgw.AmazonSideAsn,
              tags: this.convertTags(vgw.Tags),
            }
          );
          
          this.addResource(resource);
          vgwCount++;
        }
      }
      
      this.log(`Loaded ${vgwCount} VPN Gateways`, 'info');
    } catch (error) {
      this.log(`Error loading VPN Gateways: ${error}`, 'error');
      throw error;
    }
  }

  private async loadCustomerGateways(): Promise<void> {
    try {
      this.log('Loading Customer Gateways...', 'info');
      
      const command = new DescribeCustomerGatewaysCommand({});
      const response = await this.client.send(command);
      
      let cgwCount = 0;
      for (const cgw of response.CustomerGateways || []) {
        if (cgw.CustomerGatewayId) {
          const resource = this.createResource(
            cgw.CustomerGatewayId,
            this.generateCustomerGatewayName(cgw),
            'customer_gateway',
            {
              bgp_asn: cgw.BgpAsn,
              ip_address: cgw.IpAddress,
              type: cgw.Type,
              tags: this.convertTags(cgw.Tags),
            }
          );
          
          this.addResource(resource);
          cgwCount++;
        }
      }
      
      this.log(`Loaded ${cgwCount} Customer Gateways`, 'info');
    } catch (error) {
      this.log(`Error loading Customer Gateways: ${error}`, 'error');
      throw error;
    }
  }

  private async loadTransitGateways(): Promise<void> {
    try {
      this.log('Loading Transit Gateways...', 'info');
      
      const command = new DescribeTransitGatewaysCommand({});
      const response = await this.client.send(command);
      
      let tgCount = 0;
      for (const tg of response.TransitGateways || []) {
        if (tg.TransitGatewayId) {
          const resource = this.createResource(
            tg.TransitGatewayId,
            this.generateTransitGatewayName(tg),
            'transit_gateway',
            {
              amazon_side_asn: tg.Options?.AmazonSideAsn,
              description: tg.Description,
              tags: this.convertTags(tg.Tags),
            }
          );
          
          this.addResource(resource);
          tgCount++;
        }
      }
      
      this.log(`Loaded ${tgCount} Transit Gateways`, 'info');
    } catch (error) {
      this.log(`Error loading Transit Gateways: ${error}`, 'error');
      throw error;
    }
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
    this.log('Running EC2 post-conversion hook...', 'debug');
    
    // Post-process resources to clean up attributes
    for (const resource of this.resources) {
      if (resource.type === 'aws_instance') {
        // Clean up root block device attributes based on volume type
        if (resource.attributes.root_block_device) {
          const volumeType = resource.attributes.root_block_device.volume_type;
          if (!['io1', 'io2', 'gp3'].includes(volumeType)) {
            delete resource.attributes.root_block_device.iops;
          }
          if (volumeType !== 'gp3') {
            delete resource.attributes.root_block_device.throughput;
          }
        }
      }
    }
  }

  // Helper methods for generating names and mapping attributes
  private generateInstanceName(instance: any): string {
    const nameTag = instance.Tags?.find((tag: any) => tag.Key === 'Name')?.Value;
    return nameTag || `instance-${instance.InstanceId}`;
  }

  private generateVolumeName(volume: any): string {
    const nameTag = volume.Tags?.find((tag: any) => tag.Key === 'Name')?.Value;
    return nameTag || `volume-${volume.VolumeId}`;
  }

  private generateNetworkInterfaceName(eni: any): string {
    const nameTag = eni.TagSet?.find((tag: any) => tag.Key === 'Name')?.Value;
    return nameTag || `eni-${eni.NetworkInterfaceId}`;
  }

  private generateSnapshotName(snapshot: any): string {
    const nameTag = snapshot.Tags?.find((tag: any) => tag.Key === 'Name')?.Value;
    return nameTag || `snapshot-${snapshot.SnapshotId}`;
  }

  private generateImageName(image: any): string {
    const nameTag = image.Tags?.find((tag: any) => tag.Key === 'Name')?.Value;
    return nameTag || image.Name || `ami-${image.ImageId}`;
  }

  private mapVolumeAttributes(volume: any): Record<string, any> {
    return {
      size: volume.Size,
      volume_type: volume.VolumeType,
      iops: volume.Iops,
      throughput: volume.Throughput,
      encrypted: volume.Encrypted,
      kms_key_id: volume.KmsKeyId,
      availability_zone: volume.AvailabilityZone,
      snapshot_id: volume.SnapshotId,
      multi_attach_enabled: volume.MultiAttachEnabled,
      outpost_arn: volume.OutpostArn,
      fast_restored: volume.FastRestored
    };
  }

  private mapNetworkInterfaceAttributes(eni: any): Record<string, any> {
    return {
      subnet_id: eni.SubnetId,
      private_ips: eni.PrivateIpAddresses?.map((ip: any) => ip.PrivateIpAddress) || [],
      security_groups: eni.Groups?.map((sg: any) => sg.GroupId) || [],
      source_dest_check: eni.SourceDestCheck,
      description: eni.Description,
      interface_type: eni.InterfaceType,
      ipv4_prefixes: eni.Ipv4Prefixes?.map((prefix: any) => prefix.Ipv4Prefix) || [],
      ipv6_addresses: eni.Ipv6Addresses?.map((addr: any) => addr.Ipv6Address) || [],
      ipv6_prefixes: eni.Ipv6Prefixes?.map((prefix: any) => prefix.Ipv6Prefix) || []
    };
  }

  private mapSnapshotAttributes(snapshot: any): Record<string, any> {
    return {
      volume_id: snapshot.VolumeId,
      volume_size: snapshot.VolumeSize,
      description: snapshot.Description,
      encrypted: snapshot.Encrypted,
      kms_key_id: snapshot.KmsKeyId,
      owner_id: snapshot.OwnerId,
      owner_alias: snapshot.OwnerAlias,
      progress: snapshot.Progress,
      start_time: snapshot.StartTime,
      state: snapshot.State,
      state_message: snapshot.StateMessage,
      storage_tier: snapshot.StorageTier
    };
  }

  private mapImageAttributes(image: any): Record<string, any> {
    return {
      name: image.Name,
      description: image.Description,
      architecture: image.Architecture,
      creation_date: image.CreationDate,
      image_location: image.ImageLocation,
      image_type: image.ImageType,
      public: image.Public,
      kernel_id: image.KernelId,
      owner_id: image.OwnerId,
      platform: image.Platform,
      platform_details: image.PlatformDetails,
      usage_operation: image.UsageOperation,
      product_codes: image.ProductCodes?.map((pc: any) => ({
        product_code_id: pc.ProductCodeId,
        product_code_type: pc.ProductCodeType
      })) || [],
      ramdisk_id: image.RamdiskId,
      state: image.State,
      block_device_mappings: image.BlockDeviceMappings?.map((bdm: any) => ({
        device_name: bdm.DeviceName,
        ebs: bdm.Ebs ? {
          delete_on_termination: bdm.Ebs.DeleteOnTermination,
          encrypted: bdm.Ebs.Encrypted,
          iops: bdm.Ebs.Iops,
          kms_key_id: bdm.Ebs.KmsKeyId,
          snapshot_id: bdm.Ebs.SnapshotId,
          volume_size: bdm.Ebs.VolumeSize,
          volume_type: bdm.Ebs.VolumeType,
          throughput: bdm.Ebs.Throughput
        } : undefined,
        virtual_name: bdm.VirtualName
      })) || [],
      virtualization_type: image.VirtualizationType,
      hypervisor: image.Hypervisor,
      ena_support: image.EnaSupport,
      sriov_net_support: image.SriovNetSupport,
      boot_mode: image.BootMode,
      tpm_support: image.TpmSupport,
      deprecation_time: image.DeprecationTime,
      imds_support: image.ImdsSupport
    };
  }

  // Helper methods for generating names
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

  private generateRouteTableName(rt: any): string {
    const nameTag = rt.Tags?.find((tag: any) => tag.Key === 'Name')?.Value;
    return nameTag || `rt-${rt.RouteTableId}`;
  }

  private generateInternetGatewayName(igw: any): string {
    const nameTag = igw.Tags?.find((tag: any) => tag.Key === 'Name')?.Value;
    return nameTag || `igw-${igw.InternetGatewayId}`;
  }

  private generateNatGatewayName(nat: any): string {
    const nameTag = nat.Tags?.find((tag: any) => tag.Key === 'Name')?.Value;
    return nameTag || `nat-${nat.NatGatewayId}`;
  }

  private generateVpcEndpointName(endpoint: any): string {
    const nameTag = endpoint.Tags?.find((tag: any) => tag.Key === 'Name')?.Value;
    return nameTag || `vpce-${endpoint.VpcEndpointId}`;
  }

  private generateVpcPeeringConnectionName(peering: any): string {
    const nameTag = peering.Tags?.find((tag: any) => tag.Key === 'Name')?.Value;
    return nameTag || `pcx-${peering.VpcPeeringConnectionId}`;
  }

  private generateVpnConnectionName(vpn: any): string {
    const nameTag = vpn.Tags?.find((tag: any) => tag.Key === 'Name')?.Value;
    return nameTag || `vpn-${vpn.VpnConnectionId}`;
  }

  private generateVpnGatewayName(vgw: any): string {
    const nameTag = vgw.Tags?.find((tag: any) => tag.Key === 'Name')?.Value;
    return nameTag || `vgw-${vgw.VpnGatewayId}`;
  }

  private generateCustomerGatewayName(cgw: any): string {
    const nameTag = cgw.Tags?.find((tag: any) => tag.Key === 'Name')?.Value;
    return nameTag || `cgw-${cgw.CustomerGatewayId}`;
  }

  private generateTransitGatewayName(tg: any): string {
    const nameTag = tg.Tags?.find((tag: any) => tag.Key === 'Name')?.Value;
    return nameTag || `tgw-${tg.TransitGatewayId}`;
  }

  private convertTags(tags: any[] | undefined): Record<string, string> {
    const result: Record<string, string> = {};
    if (tags) {
      for (const tag of tags) {
        if (tag.Key && tag.Value) {
          result[tag.Key] = tag.Value;
        }
      }
    }
    return result;
  }

  private mapIpPermissions(permissions: any[] | undefined): any[] {
    if (!permissions) return [];
    return permissions.map(perm => ({
      from_port: perm.FromPort,
      to_port: perm.ToPort,
      protocol: perm.IpProtocol,
      cidr_blocks: perm.IpRanges?.map((rangeItem: any) => rangeItem.CidrIp),
      ipv6_cidr_blocks: perm.Ipv6Ranges?.map((rangeItem: any) => rangeItem.CidrIpv6),
      security_groups: perm.UserIdGroupPairs?.map((pair: any) => pair.GroupId),
      self: perm.UserIdGroupPairs?.some((pair: any) => pair.UserId === 'self'),
    }));
  }

  private mapRoutes(routes: any[] | undefined): any[] {
    if (!routes) return [];
    return routes.map(route => ({
      destination_cidr_block: route.DestinationCidrBlock,
      destination_ipv6_cidr_block: route.DestinationIpv6CidrBlock,
      gateway_id: route.GatewayId,
      nat_gateway_id: route.NatGatewayId,
      instance_id: route.InstanceId,
      vpc_peering_connection_id: route.VpcPeeringConnectionId,
      transit_gateway_id: route.TransitGatewayId,
      network_interface_id: route.NetworkInterfaceId,
    }));
  }
}
