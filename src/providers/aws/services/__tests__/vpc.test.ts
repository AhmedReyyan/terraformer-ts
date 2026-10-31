import { mockClient } from 'aws-sdk-client-mock';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import {
  EC2Client,
  DescribeVpcsCommand,
  DescribeSubnetsCommand,
  DescribeSecurityGroupsCommand,
  DescribeRouteTablesCommand,
  DescribeInternetGatewaysCommand,
  DescribeEgressOnlyInternetGatewaysCommand,
  DescribeNatGatewaysCommand,
  DescribeNetworkAclsCommand,
  DescribeVpcEndpointsCommand,
  DescribeVpcEndpointServiceConfigurationsCommand,
  DescribeVpcPeeringConnectionsCommand,
  DescribeDhcpOptionsCommand,
  DescribeFlowLogsCommand,
  DescribeCustomerGatewaysCommand,
  DescribeVpnGatewaysCommand,
  DescribeVpnConnectionsCommand,
  DescribeTransitGatewaysCommand,
  DescribeTransitGatewayVpcAttachmentsCommand,
  DescribeTransitGatewayRouteTablesCommand,
  GetTransitGatewayRouteTableAssociationsCommand,
  GetTransitGatewayRouteTablePropagationsCommand,
  DescribeManagedPrefixListsCommand
} from '@aws-sdk/client-ec2';
import { VPCService } from '../vpc';
import { createService, importIds } from './helpers';

const ACCOUNT = '111111111111';
const OTHER = '222222222222';
const ec2 = mockClient(EC2Client);
const sts = mockClient(STSClient);

beforeEach(() => {
  ec2.reset();
  sts.reset();
  sts.on(GetCallerIdentityCommand).resolves({ Account: ACCOUNT });
  for (const command of [
    DescribeVpcsCommand, DescribeSubnetsCommand, DescribeSecurityGroupsCommand, DescribeRouteTablesCommand,
    DescribeInternetGatewaysCommand, DescribeEgressOnlyInternetGatewaysCommand, DescribeNatGatewaysCommand,
    DescribeNetworkAclsCommand, DescribeVpcEndpointsCommand, DescribeVpcEndpointServiceConfigurationsCommand,
    DescribeVpcPeeringConnectionsCommand, DescribeDhcpOptionsCommand, DescribeFlowLogsCommand,
    DescribeCustomerGatewaysCommand, DescribeVpnGatewaysCommand, DescribeVpnConnectionsCommand,
    DescribeTransitGatewaysCommand, DescribeTransitGatewayVpcAttachmentsCommand,
    DescribeTransitGatewayRouteTablesCommand, GetTransitGatewayRouteTableAssociationsCommand,
    GetTransitGatewayRouteTablePropagationsCommand, DescribeManagedPrefixListsCommand
  ]) {
    ec2.on(command as any).resolves({});
  }
});

async function run(): Promise<VPCService> {
  const service = createService(VPCService, 'vpc', 'eu-west-1');
  await service.initResources();
  return service;
}

function ofType(service: VPCService, ...types: string[]): string[] {
  return importIds(service).filter(id => types.includes(id.split(':')[0]));
}

const amazonDhcp = (id: string) => ({
  DhcpOptionsId: id,
  OwnerId: ACCOUNT,
  DhcpConfigurations: [
    { Key: 'domain-name', Values: [{ Value: 'eu-west-1.compute.internal' }] },
    { Key: 'domain-name-servers', Values: [{ Value: 'AmazonProvidedDNS' }] }
  ]
});

describe('VPCService', () => {
  it('imports VPCs across pages with secondary CIDRs and DHCP options, skipping default and shared VPCs', async () => {
    ec2.on(DescribeVpcsCommand)
      .resolvesOnce({
        Vpcs: [
          { VpcId: 'vpc-default', IsDefault: true, OwnerId: ACCOUNT, DhcpOptionsId: 'dopt-aws' },
          {
            VpcId: 'vpc-app', OwnerId: ACCOUNT, CidrBlock: '10.0.0.0/16', DhcpOptionsId: 'dopt-corp',
            Tags: [{ Key: 'Name', Value: 'app' }],
            CidrBlockAssociationSet: [
              { AssociationId: 'vpc-cidr-assoc-primary', CidrBlock: '10.0.0.0/16', CidrBlockState: { State: 'associated' } },
              { AssociationId: 'vpc-cidr-assoc-2', CidrBlock: '10.1.0.0/16', CidrBlockState: { State: 'associated' } },
              { AssociationId: 'vpc-cidr-assoc-old', CidrBlock: '10.2.0.0/16', CidrBlockState: { State: 'disassociated' } }
            ]
          }
        ],
        NextToken: 'next'
      })
      .resolvesOnce({
        Vpcs: [
          { VpcId: 'vpc-plain', OwnerId: ACCOUNT, CidrBlock: '10.9.0.0/16', DhcpOptionsId: 'dopt-aws' },
          { VpcId: 'vpc-nodhcp', OwnerId: ACCOUNT, CidrBlock: '10.8.0.0/16', DhcpOptionsId: 'default' },
          { VpcId: 'vpc-shared', OwnerId: OTHER, CidrBlock: '10.7.0.0/16' }
        ]
      });
    ec2.on(DescribeDhcpOptionsCommand).resolves({
      DhcpOptions: [
        amazonDhcp('dopt-aws'),
        amazonDhcp('dopt-aws-lookalike'),
        { DhcpOptionsId: 'dopt-corp', OwnerId: ACCOUNT, DhcpConfigurations: [{ Key: 'domain-name', Values: [{ Value: 'corp.example' }] }] }
      ]
    });

    const service = await run();

    expect(importIds(service)).toEqual([
      'aws_vpc:vpc-app',
      'aws_vpc:vpc-nodhcp',
      'aws_vpc:vpc-plain',
      'aws_vpc_dhcp_options:dopt-corp',
      'aws_vpc_dhcp_options_association:vpc-app',
      'aws_vpc_ipv4_cidr_block_association:vpc-cidr-assoc-2'
    ]);
    expect(ec2.commandCalls(DescribeVpcsCommand)[1].args[0].input).toMatchObject({ NextToken: 'next' });
    expect(service.getWarnings()).toEqual([]);
  });

  it('imports subnets, security groups, route tables and associations, skipping AWS-created defaults', async () => {
    ec2.on(DescribeSubnetsCommand).resolves({
      Subnets: [
        { SubnetId: 'subnet-a', OwnerId: ACCOUNT },
        { SubnetId: 'subnet-default', OwnerId: ACCOUNT, DefaultForAz: true },
        { SubnetId: 'subnet-shared', OwnerId: OTHER }
      ]
    });
    ec2.on(DescribeSecurityGroupsCommand).resolves({
      SecurityGroups: [
        { GroupId: 'sg-web', GroupName: 'web', OwnerId: ACCOUNT },
        { GroupId: 'sg-default', GroupName: 'default', OwnerId: ACCOUNT },
        { GroupId: 'sg-eks', GroupName: 'eks-cluster-sg-x', OwnerId: ACCOUNT, Tags: [{ Key: 'aws:eks:cluster-name', Value: 'x' }] }
      ]
    });
    ec2.on(DescribeRouteTablesCommand).resolves({
      RouteTables: [
        {
          RouteTableId: 'rtb-main', OwnerId: ACCOUNT,
          Associations: [{ Main: true, RouteTableAssociationId: 'rtbassoc-main', AssociationState: { State: 'associated' } }]
        },
        {
          RouteTableId: 'rtb-private', OwnerId: ACCOUNT,
          Associations: [
            { SubnetId: 'subnet-a', RouteTableAssociationId: 'rtbassoc-1', AssociationState: { State: 'associated' } },
            { GatewayId: 'igw-1', RouteTableAssociationId: 'rtbassoc-2', AssociationState: { State: 'associated' } },
            { SubnetId: 'subnet-old', RouteTableAssociationId: 'rtbassoc-3', AssociationState: { State: 'disassociated' } }
          ]
        }
      ]
    });

    const service = await run();

    expect(ofType(service, 'aws_subnet', 'aws_security_group', 'aws_route_table', 'aws_route_table_association')).toEqual([
      'aws_route_table:rtb-private',
      'aws_route_table_association:igw-1/rtb-private',
      'aws_route_table_association:subnet-a/rtb-private',
      'aws_security_group:sg-web',
      'aws_subnet:subnet-a'
    ]);
  });

  it('imports gateways, ACLs and endpoints, skipping defaults and gone objects', async () => {
    ec2.on(DescribeVpcsCommand).resolves({ Vpcs: [{ VpcId: 'vpc-default', IsDefault: true, OwnerId: ACCOUNT }] });
    ec2.on(DescribeInternetGatewaysCommand).resolves({
      InternetGateways: [
        { InternetGatewayId: 'igw-app', OwnerId: ACCOUNT, Attachments: [{ VpcId: 'vpc-app', State: 'attached' }] },
        { InternetGatewayId: 'igw-default', OwnerId: ACCOUNT, Attachments: [{ VpcId: 'vpc-default', State: 'attached' }] }
      ]
    });
    ec2.on(DescribeEgressOnlyInternetGatewaysCommand).resolves({
      EgressOnlyInternetGateways: [{ EgressOnlyInternetGatewayId: 'eigw-1', Attachments: [{ VpcId: 'vpc-app', State: 'attached' }] }]
    });
    ec2.on(DescribeNatGatewaysCommand).resolves({
      NatGateways: [
        { NatGatewayId: 'nat-ok', State: 'available' },
        { NatGatewayId: 'nat-deleted', State: 'deleted' },
        { NatGatewayId: 'nat-failed', State: 'failed' }
      ]
    });
    ec2.on(DescribeNetworkAclsCommand).resolves({
      NetworkAcls: [
        { NetworkAclId: 'acl-custom', IsDefault: false, OwnerId: ACCOUNT },
        { NetworkAclId: 'acl-default', IsDefault: true, OwnerId: ACCOUNT }
      ]
    });
    ec2.on(DescribeVpcEndpointsCommand).resolves({
      VpcEndpoints: [
        { VpcEndpointId: 'vpce-s3', State: 'Available', OwnerId: ACCOUNT, ServiceName: 'com.amazonaws.eu-west-1.s3' },
        { VpcEndpointId: 'vpce-managed', State: 'Available', OwnerId: ACCOUNT, RequesterManaged: true },
        { VpcEndpointId: 'vpce-deleted', State: 'Deleted', OwnerId: ACCOUNT },
        { VpcEndpointId: 'vpce-rejected', State: 'Rejected', OwnerId: ACCOUNT }
      ]
    });
    ec2.on(DescribeVpcEndpointServiceConfigurationsCommand).resolves({
      ServiceConfigurations: [
        { ServiceId: 'vpce-svc-1', ServiceState: 'Available' },
        { ServiceId: 'vpce-svc-2', ServiceState: 'Deleting' }
      ]
    });
    ec2.on(DescribeFlowLogsCommand).resolves({ FlowLogs: [{ FlowLogId: 'fl-1', ResourceId: 'vpc-app' }] });

    const service = await run();

    expect(importIds(service)).toEqual([
      'aws_egress_only_internet_gateway:eigw-1',
      'aws_flow_log:fl-1',
      'aws_internet_gateway:igw-app',
      'aws_nat_gateway:nat-ok',
      'aws_network_acl:acl-custom',
      'aws_vpc_endpoint:vpce-s3',
      'aws_vpc_endpoint_service:vpce-svc-1'
    ]);
  });

  it('imports the requester side of peerings as connections and accepted cross-account peerings as accepters', async () => {
    ec2.on(DescribeVpcPeeringConnectionsCommand).resolves({
      VpcPeeringConnections: [
        {
          VpcPeeringConnectionId: 'pcx-local', Status: { Code: 'active' },
          RequesterVpcInfo: { OwnerId: ACCOUNT, Region: 'eu-west-1', VpcId: 'vpc-a' },
          AccepterVpcInfo: { OwnerId: ACCOUNT, Region: 'eu-west-1', VpcId: 'vpc-b' }
        },
        {
          VpcPeeringConnectionId: 'pcx-pending-out', Status: { Code: 'pending-acceptance' },
          RequesterVpcInfo: { OwnerId: ACCOUNT, Region: 'eu-west-1' },
          AccepterVpcInfo: { OwnerId: OTHER, Region: 'eu-west-1' }
        },
        {
          VpcPeeringConnectionId: 'pcx-accepted', Status: { Code: 'active' },
          RequesterVpcInfo: { OwnerId: OTHER, Region: 'eu-west-1' },
          AccepterVpcInfo: { OwnerId: ACCOUNT, Region: 'eu-west-1' }
        },
        {
          VpcPeeringConnectionId: 'pcx-cross-region', Status: { Code: 'active' },
          RequesterVpcInfo: { OwnerId: ACCOUNT, Region: 'us-east-1' },
          AccepterVpcInfo: { OwnerId: ACCOUNT, Region: 'eu-west-1' }
        },
        {
          VpcPeeringConnectionId: 'pcx-pending-in', Status: { Code: 'pending-acceptance' },
          RequesterVpcInfo: { OwnerId: OTHER, Region: 'eu-west-1' },
          AccepterVpcInfo: { OwnerId: ACCOUNT, Region: 'eu-west-1' }
        },
        { VpcPeeringConnectionId: 'pcx-deleted', Status: { Code: 'deleted' }, RequesterVpcInfo: { OwnerId: ACCOUNT } }
      ]
    });

    const service = await run();

    expect(importIds(service)).toEqual([
      'aws_vpc_peering_connection:pcx-local',
      'aws_vpc_peering_connection:pcx-pending-out',
      'aws_vpc_peering_connection_accepter:pcx-accepted',
      'aws_vpc_peering_connection_accepter:pcx-cross-region'
    ]);
    expect(ec2.commandCalls(DescribeVpcPeeringConnectionsCommand)[0].args[0].input).toMatchObject({
      Filters: [{ Name: 'status-code', Values: ['active', 'pending-acceptance'] }]
    });
  });

  it('imports VPN and transit gateway resources owned by the account', async () => {
    ec2.on(DescribeCustomerGatewaysCommand).resolves({
      CustomerGateways: [{ CustomerGatewayId: 'cgw-1', State: 'available' }, { CustomerGatewayId: 'cgw-2', State: 'deleted' }]
    });
    ec2.on(DescribeVpnGatewaysCommand).resolves({
      VpnGateways: [{ VpnGatewayId: 'vgw-1', State: 'available' }, { VpnGatewayId: 'vgw-2', State: 'deleting' }]
    });
    ec2.on(DescribeVpnConnectionsCommand).resolves({
      VpnConnections: [{ VpnConnectionId: 'vpn-1', State: 'available' }, { VpnConnectionId: 'vpn-2', State: 'deleted' }]
    });
    ec2.on(DescribeTransitGatewaysCommand).resolves({
      TransitGateways: [
        { TransitGatewayId: 'tgw-1', State: 'available', OwnerId: ACCOUNT },
        { TransitGatewayId: 'tgw-shared', State: 'available', OwnerId: OTHER },
        { TransitGatewayId: 'tgw-old', State: 'deleted', OwnerId: ACCOUNT }
      ]
    });
    ec2.on(DescribeTransitGatewayVpcAttachmentsCommand).resolves({
      TransitGatewayVpcAttachments: [
        { TransitGatewayAttachmentId: 'tgw-attach-1', State: 'available', VpcOwnerId: ACCOUNT },
        { TransitGatewayAttachmentId: 'tgw-attach-foreign', State: 'available', VpcOwnerId: OTHER },
        { TransitGatewayAttachmentId: 'tgw-attach-gone', State: 'deleting', VpcOwnerId: ACCOUNT }
      ]
    });
    ec2.on(DescribeTransitGatewayRouteTablesCommand).resolves({
      TransitGatewayRouteTables: [
        { TransitGatewayRouteTableId: 'tgw-rtb-default', State: 'available', DefaultAssociationRouteTable: true, DefaultPropagationRouteTable: true },
        { TransitGatewayRouteTableId: 'tgw-rtb-1', State: 'available' }
      ]
    });
    ec2.on(GetTransitGatewayRouteTableAssociationsCommand, { TransitGatewayRouteTableId: 'tgw-rtb-1' })
      .resolvesOnce({ Associations: [{ TransitGatewayAttachmentId: 'tgw-attach-1', State: 'associated' }], NextToken: 'n' })
      .resolvesOnce({ Associations: [{ TransitGatewayAttachmentId: 'tgw-attach-2', State: 'disassociating' }] });
    ec2.on(GetTransitGatewayRouteTablePropagationsCommand, { TransitGatewayRouteTableId: 'tgw-rtb-1' }).resolves({
      TransitGatewayRouteTablePropagations: [
        { TransitGatewayAttachmentId: 'tgw-attach-1', State: 'enabled' },
        { TransitGatewayAttachmentId: 'tgw-attach-3', State: 'disabled' }
      ]
    });

    const service = await run();

    expect(importIds(service)).toEqual([
      'aws_customer_gateway:cgw-1',
      'aws_ec2_transit_gateway:tgw-1',
      'aws_ec2_transit_gateway_route_table:tgw-rtb-1',
      'aws_ec2_transit_gateway_route_table_association:tgw-rtb-1_tgw-attach-1',
      'aws_ec2_transit_gateway_route_table_propagation:tgw-rtb-1_tgw-attach-1',
      'aws_ec2_transit_gateway_vpc_attachment:tgw-attach-1',
      'aws_vpn_connection:vpn-1',
      'aws_vpn_gateway:vgw-1'
    ]);
    expect(ec2.commandCalls(GetTransitGatewayRouteTableAssociationsCommand)).toHaveLength(2);
  });

  it('imports only customer-owned managed prefix lists', async () => {
    ec2.on(DescribeManagedPrefixListsCommand).resolves({
      PrefixLists: [
        { PrefixListId: 'pl-office', PrefixListName: 'office', OwnerId: ACCOUNT, State: 'create-complete' },
        { PrefixListId: 'pl-s3', PrefixListName: 'com.amazonaws.eu-west-1.s3', OwnerId: 'AWS', State: 'create-complete' },
        { PrefixListId: 'pl-shared', PrefixListName: 'shared', OwnerId: OTHER, State: 'create-complete' },
        { PrefixListId: 'pl-old', PrefixListName: 'old', OwnerId: ACCOUNT, State: 'delete-in-progress' }
      ]
    });

    expect(importIds(await run())).toEqual(['aws_ec2_managed_prefix_list:pl-office']);
  });

  it('warns but still imports when the account ID cannot be determined', async () => {
    sts.on(GetCallerIdentityCommand).rejects(new Error('no credentials'));
    ec2.on(DescribeSubnetsCommand).resolves({ Subnets: [{ SubnetId: 'subnet-a', OwnerId: ACCOUNT }] });

    const service = await run();

    expect(importIds(service)).toEqual(['aws_subnet:subnet-a']);
    expect(service.getWarnings()[0]).toContain('account ID');
  });
});
