import {
  EC2Client,
  DhcpOptions,
  Tag,
  paginateDescribeVpcs,
  paginateDescribeSubnets,
  paginateDescribeSecurityGroups,
  paginateDescribeRouteTables,
  paginateDescribeInternetGateways,
  paginateDescribeEgressOnlyInternetGateways,
  paginateDescribeNatGateways,
  paginateDescribeNetworkAcls,
  paginateDescribeVpcEndpoints,
  paginateDescribeVpcEndpointServiceConfigurations,
  paginateDescribeVpcPeeringConnections,
  paginateDescribeDhcpOptions,
  paginateDescribeFlowLogs,
  paginateDescribeTransitGateways,
  paginateDescribeTransitGatewayVpcAttachments,
  paginateDescribeTransitGatewayRouteTables,
  paginateGetTransitGatewayRouteTableAssociations,
  paginateGetTransitGatewayRouteTablePropagations,
  paginateDescribeManagedPrefixLists,
  DescribeCustomerGatewaysCommand,
  DescribeVpnGatewaysCommand,
  DescribeVpnConnectionsCommand
} from '@aws-sdk/client-ec2';
import { describeError, mapLimit } from '../../../core/provider';
import { AwsService, tagMap, nameTag } from '../aws-service';

/** States of objects that are gone or never came up (compared case-insensitively, the APIs mix cases). */
const GONE_STATES = new Set([
  'deleted', 'deleting', 'delete-complete', 'delete-in-progress', 'delete-failed',
  'failed', 'failing', 'rejected', 'rejecting', 'expired'
]);

function gone(state?: string): boolean {
  return state !== undefined && GONE_STATES.has(state.toLowerCase());
}

/** The DHCP option set AWS creates in every region: AmazonProvidedDNS + the region's internal domain, untagged. */
function isAwsDefaultDhcpOptions(options: DhcpOptions, region: string): boolean {
  if (options.Tags?.length) {
    return false;
  }
  const config: Record<string, string> = {};
  for (const entry of options.DhcpConfigurations || []) {
    config[entry.Key || ''] = (entry.Values || []).map(v => v.Value).join(',');
  }
  const domain = region === 'us-east-1' ? 'ec2.internal' : `${region}.compute.internal`;
  return Object.keys(config).length === 2 &&
    config['domain-name'] === domain &&
    config['domain-name-servers'] === 'AmazonProvidedDNS';
}

export class VPCService extends AwsService {
  async initResources(): Promise<void> {
    const ec2 = this.client(EC2Client);

    // Objects shared from other accounts through RAM (VPCs, subnets, transit gateways, prefix lists)
    // are managed by their owner, so only resources owned by this account are imported.
    let account: string | undefined;
    try {
      account = await this.accountId();
    } catch (error) {
      this.warn(`could not determine the account ID, resources shared by other accounts may be included: ${describeError(error)}`);
    }
    const owned = (ownerId?: string) => !account || !ownerId || ownerId === account;

    // The default VPC, and everything AWS created with it, is skipped (aws_default_* territory).
    let defaultVpcId: string | undefined;
    let defaultVpcDhcpOptions: string | undefined;
    const vpcDhcpOptions: Array<{ vpcId: string; optionsId: string; name: string }> = [];

    await this.collect('VPCs', async () => {
      for await (const page of paginateDescribeVpcs({ client: ec2 }, {})) {
        for (const vpc of page.Vpcs || []) {
          if (!vpc.VpcId || !owned(vpc.OwnerId)) {
            continue;
          }
          if (vpc.IsDefault) {
            defaultVpcId = vpc.VpcId;
            defaultVpcDhcpOptions = vpc.DhcpOptionsId;
            continue;
          }
          const name = nameTag(vpc.Tags, vpc.VpcId);
          this.add('aws_vpc', vpc.VpcId, name, { id: vpc.VpcId, cidr_block: vpc.CidrBlock, tags: tagMap(vpc.Tags) });
          // Secondary IPv4 CIDRs are not part of aws_vpc.
          for (const association of vpc.CidrBlockAssociationSet || []) {
            if (association.AssociationId && association.CidrBlock !== vpc.CidrBlock &&
                association.CidrBlockState?.State === 'associated') {
              this.add('aws_vpc_ipv4_cidr_block_association', association.AssociationId, `${name}_${association.CidrBlock}`, {
                id: association.AssociationId,
                vpc_id: vpc.VpcId,
                cidr_block: association.CidrBlock
              });
            }
          }
          if (vpc.DhcpOptionsId && vpc.DhcpOptionsId !== 'default') {
            vpcDhcpOptions.push({ vpcId: vpc.VpcId, optionsId: vpc.DhcpOptionsId, name });
          }
        }
      }
    });

    await this.collect('DHCP option sets', async () => {
      const awsDefault = new Set<string>(defaultVpcDhcpOptions ? [defaultVpcDhcpOptions] : []);
      for await (const page of paginateDescribeDhcpOptions({ client: ec2 }, {})) {
        for (const options of page.DhcpOptions || []) {
          if (!options.DhcpOptionsId || !owned(options.OwnerId)) {
            continue;
          }
          if (awsDefault.has(options.DhcpOptionsId) || isAwsDefaultDhcpOptions(options, this.region)) {
            awsDefault.add(options.DhcpOptionsId);
            continue;
          }
          this.add('aws_vpc_dhcp_options', options.DhcpOptionsId, nameTag(options.Tags, options.DhcpOptionsId), {
            id: options.DhcpOptionsId,
            tags: tagMap(options.Tags)
          });
        }
      }
      // The association ID is the VPC ID. VPCs still using the AWS default set have nothing to manage.
      for (const { vpcId, optionsId, name } of vpcDhcpOptions) {
        if (!awsDefault.has(optionsId)) {
          this.add('aws_vpc_dhcp_options_association', vpcId, name, { vpc_id: vpcId, dhcp_options_id: optionsId });
        }
      }
    });

    await this.collect('subnets', async () => {
      for await (const page of paginateDescribeSubnets({ client: ec2 }, {})) {
        for (const subnet of page.Subnets || []) {
          // Default subnets are created by AWS with the default VPC.
          if (!subnet.SubnetId || subnet.DefaultForAz || !owned(subnet.OwnerId)) {
            continue;
          }
          this.add('aws_subnet', subnet.SubnetId, nameTag(subnet.Tags, subnet.SubnetId), {
            id: subnet.SubnetId,
            vpc_id: subnet.VpcId,
            cidr_block: subnet.CidrBlock,
            tags: tagMap(subnet.Tags)
          });
        }
      }
    });

    await this.collect('security groups', async () => {
      for await (const page of paginateDescribeSecurityGroups({ client: ec2 }, {})) {
        for (const group of page.SecurityGroups || []) {
          // Rules are inline in aws_security_group, so no aws_security_group_rule / aws_vpc_security_group_*_rule.
          // The "default" group of each VPC is created by AWS; EKS-created cluster groups belong to the cluster.
          if (!group.GroupId || group.GroupName === 'default' || !owned(group.OwnerId) ||
              group.Tags?.some(tag => tag.Key === 'aws:eks:cluster-name')) {
            continue;
          }
          this.add('aws_security_group', group.GroupId, group.GroupName || group.GroupId, {
            id: group.GroupId,
            name: group.GroupName,
            vpc_id: group.VpcId,
            tags: tagMap(group.Tags)
          });
        }
      }
    });

    await this.collect('route tables', async () => {
      for await (const page of paginateDescribeRouteTables({ client: ec2 }, {})) {
        for (const table of page.RouteTables || []) {
          if (!table.RouteTableId || !owned(table.OwnerId)) {
            continue;
          }
          const associations = table.Associations || [];
          const name = nameTag(table.Tags, table.RouteTableId);
          // The main route table is created with the VPC (aws_default_route_table territory). Routes and
          // propagating VGWs are inline in aws_route_table, so aws_route is never imported.
          if (!associations.some(association => association.Main)) {
            this.add('aws_route_table', table.RouteTableId, name, {
              id: table.RouteTableId,
              vpc_id: table.VpcId,
              tags: tagMap(table.Tags)
            });
          }
          for (const association of associations) {
            const target = association.SubnetId || association.GatewayId;
            // Explicit subnet / gateway (edge) associations only; the implicit Main association is not a resource.
            if (association.Main || !target || association.AssociationState?.State !== 'associated') {
              continue;
            }
            this.add('aws_route_table_association', `${target}/${table.RouteTableId}`, `${name}_${target}`, {
              id: association.RouteTableAssociationId,
              route_table_id: table.RouteTableId,
              subnet_id: association.SubnetId,
              gateway_id: association.GatewayId
            });
          }
        }
      }
    });

    await this.collect('internet gateways', async () => {
      for await (const page of paginateDescribeInternetGateways({ client: ec2 }, {})) {
        for (const gateway of page.InternetGateways || []) {
          const vpcId = gateway.Attachments?.[0]?.VpcId;
          // The default VPC's gateway is created by AWS. The attachment is inline (vpc_id), so no
          // aws_internet_gateway_attachment.
          if (!gateway.InternetGatewayId || !owned(gateway.OwnerId) || (vpcId && vpcId === defaultVpcId)) {
            continue;
          }
          this.add('aws_internet_gateway', gateway.InternetGatewayId, nameTag(gateway.Tags, gateway.InternetGatewayId), {
            id: gateway.InternetGatewayId,
            vpc_id: vpcId,
            tags: tagMap(gateway.Tags)
          });
        }
      }
    });

    await this.collect('egress-only internet gateways', async () => {
      for await (const page of paginateDescribeEgressOnlyInternetGateways({ client: ec2 }, {})) {
        for (const gateway of page.EgressOnlyInternetGateways || []) {
          const id = gateway.EgressOnlyInternetGatewayId;
          if (!id || gateway.Attachments?.some(attachment => gone(attachment.State))) {
            continue;
          }
          this.add('aws_egress_only_internet_gateway', id, nameTag(gateway.Tags, id), {
            id,
            vpc_id: gateway.Attachments?.[0]?.VpcId,
            tags: tagMap(gateway.Tags)
          });
        }
      }
    });

    await this.collect('NAT gateways', async () => {
      for await (const page of paginateDescribeNatGateways({ client: ec2 }, {})) {
        for (const gateway of page.NatGateways || []) {
          if (!gateway.NatGatewayId || gone(gateway.State)) {
            continue;
          }
          this.add('aws_nat_gateway', gateway.NatGatewayId, nameTag(gateway.Tags, gateway.NatGatewayId), {
            id: gateway.NatGatewayId,
            subnet_id: gateway.SubnetId,
            vpc_id: gateway.VpcId,
            tags: tagMap(gateway.Tags)
          });
        }
      }
    });

    await this.collect('network ACLs', async () => {
      for await (const page of paginateDescribeNetworkAcls({ client: ec2 }, {})) {
        for (const acl of page.NetworkAcls || []) {
          // Default ACLs are created with the VPC. Rules and subnet_ids are inline, so neither
          // aws_network_acl_rule nor aws_network_acl_association is imported.
          if (!acl.NetworkAclId || acl.IsDefault || !owned(acl.OwnerId)) {
            continue;
          }
          this.add('aws_network_acl', acl.NetworkAclId, nameTag(acl.Tags, acl.NetworkAclId), {
            id: acl.NetworkAclId,
            vpc_id: acl.VpcId,
            tags: tagMap(acl.Tags)
          });
        }
      }
    });

    await this.collect('VPC endpoints', async () => {
      for await (const page of paginateDescribeVpcEndpoints({ client: ec2 }, {})) {
        for (const endpoint of page.VpcEndpoints || []) {
          // Requester-managed endpoints are created by AWS services on the user's behalf. Route table,
          // subnet and security group associations are inline.
          if (!endpoint.VpcEndpointId || endpoint.RequesterManaged || gone(endpoint.State) || !owned(endpoint.OwnerId)) {
            continue;
          }
          this.add('aws_vpc_endpoint', endpoint.VpcEndpointId, nameTag(endpoint.Tags, endpoint.ServiceName || endpoint.VpcEndpointId), {
            id: endpoint.VpcEndpointId,
            service_name: endpoint.ServiceName,
            vpc_id: endpoint.VpcId,
            tags: tagMap(endpoint.Tags)
          });
        }
      }
    });

    await this.collect('VPC endpoint services', async () => {
      for await (const page of paginateDescribeVpcEndpointServiceConfigurations({ client: ec2 }, {})) {
        for (const service of page.ServiceConfigurations || []) {
          if (!service.ServiceId || gone(service.ServiceState)) {
            continue;
          }
          this.add('aws_vpc_endpoint_service', service.ServiceId, nameTag(service.Tags, service.ServiceId), {
            id: service.ServiceId,
            service_name: service.ServiceName,
            tags: tagMap(service.Tags)
          });
        }
      }
    });

    await this.collect('VPC peering connections', async () => {
      const input = { Filters: [{ Name: 'status-code', Values: ['active', 'pending-acceptance'] }] };
      for await (const page of paginateDescribeVpcPeeringConnections({ client: ec2 }, input)) {
        for (const peering of page.VpcPeeringConnections || []) {
          const id = peering.VpcPeeringConnectionId;
          const status = peering.Status?.Code;
          if (!id || (status !== 'active' && status !== 'pending-acceptance')) {
            continue;
          }
          const requester = peering.RequesterVpcInfo;
          const accepter = peering.AccepterVpcInfo;
          const attributes = {
            id,
            vpc_id: requester?.VpcId,
            peer_vpc_id: accepter?.VpcId,
            tags: tagMap(peering.Tags)
          };
          const isLocal = (info?: { OwnerId?: string; Region?: string }) =>
            owned(info?.OwnerId) && (!info?.Region || info.Region === this.region);
          // The requester side is aws_vpc_peering_connection; the accepter side of a cross-account or
          // cross-region peering is aws_vpc_peering_connection_accepter (only once accepted, so that an
          // apply does not accept a pending request).
          if (isLocal(requester)) {
            this.add('aws_vpc_peering_connection', id, nameTag(peering.Tags, id), attributes);
          } else if (isLocal(accepter) && status === 'active') {
            this.add('aws_vpc_peering_connection_accepter', id, nameTag(peering.Tags, id), attributes);
          }
        }
      }
    });

    await this.collect('flow logs', async () => {
      for await (const page of paginateDescribeFlowLogs({ client: ec2 }, {})) {
        for (const log of page.FlowLogs || []) {
          if (log.FlowLogId) {
            this.add('aws_flow_log', log.FlowLogId, nameTag(log.Tags, `${log.ResourceId || log.FlowLogId}_flow_log`), {
              id: log.FlowLogId,
              resource_id: log.ResourceId,
              tags: tagMap(log.Tags)
            });
          }
        }
      }
    });

    // The three VPN APIs are not paginated.
    await this.collect('customer gateways', async () => {
      const response = await ec2.send(new DescribeCustomerGatewaysCommand({}));
      for (const gateway of response.CustomerGateways || []) {
        if (gateway.CustomerGatewayId && !gone(gateway.State)) {
          this.addTagged('aws_customer_gateway', gateway.CustomerGatewayId, gateway.Tags);
        }
      }
    });

    await this.collect('VPN gateways', async () => {
      const response = await ec2.send(new DescribeVpnGatewaysCommand({}));
      for (const gateway of response.VpnGateways || []) {
        // The VPC attachment is inline (vpc_id), so aws_vpn_gateway_attachment is not imported.
        if (gateway.VpnGatewayId && !gone(gateway.State)) {
          this.addTagged('aws_vpn_gateway', gateway.VpnGatewayId, gateway.Tags);
        }
      }
    });

    await this.collect('VPN connections', async () => {
      const response = await ec2.send(new DescribeVpnConnectionsCommand({}));
      for (const connection of response.VpnConnections || []) {
        if (connection.VpnConnectionId && !gone(connection.State)) {
          this.addTagged('aws_vpn_connection', connection.VpnConnectionId, connection.Tags);
        }
      }
    });

    await this.collect('transit gateways', async () => {
      for await (const page of paginateDescribeTransitGateways({ client: ec2 }, {})) {
        for (const gateway of page.TransitGateways || []) {
          if (gateway.TransitGatewayId && !gone(gateway.State) && owned(gateway.OwnerId)) {
            this.addTagged('aws_ec2_transit_gateway', gateway.TransitGatewayId, gateway.Tags);
          }
        }
      }
    });

    await this.collect('transit gateway VPC attachments', async () => {
      for await (const page of paginateDescribeTransitGatewayVpcAttachments({ client: ec2 }, {})) {
        for (const attachment of page.TransitGatewayVpcAttachments || []) {
          // The attachment belongs to the VPC owner (the TGW owner would use the _accepter resource).
          if (attachment.TransitGatewayAttachmentId && !gone(attachment.State) && owned(attachment.VpcOwnerId)) {
            this.addTagged('aws_ec2_transit_gateway_vpc_attachment', attachment.TransitGatewayAttachmentId, attachment.Tags);
          }
        }
      }
    });

    const routeTables: Array<{ id: string; name: string }> = [];
    await this.collect('transit gateway route tables', async () => {
      for await (const page of paginateDescribeTransitGatewayRouteTables({ client: ec2 }, {})) {
        for (const table of page.TransitGatewayRouteTables || []) {
          const id = table.TransitGatewayRouteTableId;
          // The default association/propagation route table is created by the transit gateway itself.
          if (!id || gone(table.State) || table.DefaultAssociationRouteTable || table.DefaultPropagationRouteTable) {
            continue;
          }
          const resource = this.addTagged('aws_ec2_transit_gateway_route_table', id, table.Tags);
          routeTables.push({ id, name: resource.name });
        }
      }
    });

    // Associations and propagations of non-default route tables are standalone resources
    // (the attachment's transit_gateway_default_route_table_* flags only cover the default table).
    await mapLimit(routeTables, 5, table => this.collect(`transit gateway route table ${table.id} associations`, async () => {
      for await (const page of paginateGetTransitGatewayRouteTableAssociations({ client: ec2 }, { TransitGatewayRouteTableId: table.id })) {
        for (const association of page.Associations || []) {
          if (association.TransitGatewayAttachmentId && association.State === 'associated') {
            this.add('aws_ec2_transit_gateway_route_table_association',
              `${table.id}_${association.TransitGatewayAttachmentId}`,
              `${table.name}_${association.TransitGatewayAttachmentId}`,
              { transit_gateway_route_table_id: table.id, transit_gateway_attachment_id: association.TransitGatewayAttachmentId });
          }
        }
      }
      for await (const page of paginateGetTransitGatewayRouteTablePropagations({ client: ec2 }, { TransitGatewayRouteTableId: table.id })) {
        for (const propagation of page.TransitGatewayRouteTablePropagations || []) {
          if (propagation.TransitGatewayAttachmentId && propagation.State === 'enabled') {
            this.add('aws_ec2_transit_gateway_route_table_propagation',
              `${table.id}_${propagation.TransitGatewayAttachmentId}`,
              `${table.name}_${propagation.TransitGatewayAttachmentId}`,
              { transit_gateway_route_table_id: table.id, transit_gateway_attachment_id: propagation.TransitGatewayAttachmentId });
          }
        }
      }
    }));

    await this.collect('managed prefix lists', async () => {
      for await (const page of paginateDescribeManagedPrefixLists({ client: ec2 }, {})) {
        for (const list of page.PrefixLists || []) {
          // AWS-owned lists (com.amazonaws.*) are read-only. Entries are inline, so no
          // aws_ec2_managed_prefix_list_entry.
          if (!list.PrefixListId || list.OwnerId === 'AWS' || list.PrefixListName?.startsWith('com.amazonaws.') ||
              gone(list.State) || !owned(list.OwnerId)) {
            continue;
          }
          this.add('aws_ec2_managed_prefix_list', list.PrefixListId, list.PrefixListName || list.PrefixListId, {
            id: list.PrefixListId,
            name: list.PrefixListName,
            arn: list.PrefixListArn,
            tags: tagMap(list.Tags)
          });
        }
      }
    });
  }

  /** Resources whose import ID is their EC2 ID and whose name is the Name tag. */
  private addTagged(type: string, id: string, tags: Tag[] | undefined) {
    return this.add(type, id, nameTag(tags, id), { id, tags: tagMap(tags) });
  }
}
