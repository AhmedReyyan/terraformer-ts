import { mockClient } from 'aws-sdk-client-mock';
import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeVolumesCommand,
  DescribeKeyPairsCommand,
  DescribeAddressesCommand,
  DescribeLaunchTemplatesCommand,
  DescribeImagesCommand,
  DescribePlacementGroupsCommand,
  DescribeNetworkInterfacesCommand
} from '@aws-sdk/client-ec2';
import { EC2Service } from '../ec2';
import { createService, importIds } from './helpers';

const ec2 = mockClient(EC2Client);

beforeEach(() => {
  ec2.reset();
  ec2.on(DescribeInstancesCommand).resolves({});
  ec2.on(DescribeVolumesCommand).resolves({});
  ec2.on(DescribeKeyPairsCommand).resolves({});
  ec2.on(DescribeAddressesCommand).resolves({});
  ec2.on(DescribeLaunchTemplatesCommand).resolves({});
  ec2.on(DescribeImagesCommand).resolves({});
  ec2.on(DescribePlacementGroupsCommand).resolves({});
  ec2.on(DescribeNetworkInterfacesCommand).resolves({});
});

async function run(): Promise<EC2Service> {
  const service = createService(EC2Service, 'ec2', 'eu-west-1');
  await service.initResources();
  return service;
}

describe('EC2Service', () => {
  it('imports instances across pages and skips terminated and externally owned ones', async () => {
    ec2.on(DescribeInstancesCommand)
      .resolvesOnce({
        Reservations: [{ Instances: [
          { InstanceId: 'i-web', State: { Name: 'running' }, Tags: [{ Key: 'Name', Value: 'web' }] },
          { InstanceId: 'i-gone', State: { Name: 'terminated' } },
          { InstanceId: 'i-stopping', State: { Name: 'shutting-down' } }
        ] }],
        NextToken: 'page2'
      })
      .resolvesOnce({
        Reservations: [{ Instances: [
          { InstanceId: 'i-stopped', State: { Name: 'stopped' } },
          { InstanceId: 'i-asg', State: { Name: 'running' }, Tags: [{ Key: 'aws:autoscaling:groupName', Value: 'web-asg' }] },
          { InstanceId: 'i-fleet', State: { Name: 'running' }, Tags: [{ Key: 'aws:ec2:fleet-id', Value: 'fleet-1' }] },
          { InstanceId: 'i-karpenter', State: { Name: 'running' }, Tags: [{ Key: 'karpenter.sh/nodepool', Value: 'default' }] },
          { InstanceId: 'i-managed', State: { Name: 'running' }, Operator: { Managed: true } }
        ] }]
      });

    const service = await run();

    expect(importIds(service)).toEqual(['aws_instance:i-stopped', 'aws_instance:i-web']);
    expect(ec2.commandCalls(DescribeInstancesCommand)[1].args[0].input).toMatchObject({ NextToken: 'page2' });
    expect(service.getResources().find(r => r.id === 'i-web')?.attributes.tags).toEqual({ Name: 'web' });
    expect(service.getWarnings()).toEqual([]);
  });

  it('imports only unattached EBS volumes', async () => {
    ec2.on(DescribeVolumesCommand).resolves({
      Volumes: [
        { VolumeId: 'vol-free', State: 'available', Tags: [{ Key: 'Name', Value: 'data' }] },
        { VolumeId: 'vol-attached', State: 'in-use', Attachments: [{ InstanceId: 'i-web', Device: '/dev/sdf' }] },
        { VolumeId: 'vol-creating', State: 'creating' },
        { VolumeId: 'vol-deleting', State: 'deleting' },
        { VolumeId: 'vol-managed', State: 'available', Operator: { Managed: true } }
      ]
    });

    expect(importIds(await run())).toEqual(['aws_ebs_volume:vol-free']);
  });

  it('imports key pairs, Elastic IPs, launch templates, AMIs and placement groups', async () => {
    ec2.on(DescribeKeyPairsCommand).resolves({ KeyPairs: [{ KeyName: 'deployer', KeyPairId: 'key-1' }] });
    ec2.on(DescribeAddressesCommand).resolves({
      Addresses: [
        { AllocationId: 'eipalloc-1', PublicIp: '1.2.3.4' },
        { PublicIp: '5.6.7.8', Domain: 'standard' },
        { AllocationId: 'eipalloc-alb', ServiceManaged: 'alb' }
      ]
    });
    ec2.on(DescribeLaunchTemplatesCommand)
      .resolvesOnce({ LaunchTemplates: [{ LaunchTemplateId: 'lt-1', LaunchTemplateName: 'web' }], NextToken: 't' })
      .resolvesOnce({
        LaunchTemplates: [
          { LaunchTemplateId: 'lt-2', LaunchTemplateName: 'worker' },
          { LaunchTemplateId: 'lt-eks', LaunchTemplateName: 'eks-123', Tags: [{ Key: 'eks:nodegroup-name', Value: 'ng' }] }
        ]
      });
    ec2.on(DescribeImagesCommand).resolves({
      Images: [
        { ImageId: 'ami-1', Name: 'golden', State: 'available' },
        { ImageId: 'ami-pending', State: 'pending' },
        { ImageId: 'ami-failed', State: 'failed' }
      ]
    });
    ec2.on(DescribePlacementGroupsCommand).resolves({
      PlacementGroups: [
        { GroupName: 'cluster-pg', State: 'available', Strategy: 'cluster' },
        { GroupName: 'old-pg', State: 'deleting' }
      ]
    });

    const service = await run();

    expect(importIds(service)).toEqual([
      'aws_ami:ami-1',
      'aws_eip:eipalloc-1',
      'aws_key_pair:deployer',
      'aws_launch_template:lt-1',
      'aws_launch_template:lt-2',
      'aws_placement_group:cluster-pg'
    ]);
    expect(ec2.commandCalls(DescribeImagesCommand)[0].args[0].input).toMatchObject({ Owners: ['self'] });
  });

  it('imports only standalone user-created network interfaces', async () => {
    ec2.on(DescribeInstancesCommand).resolves({
      Reservations: [{ Instances: [
        { InstanceId: 'i-web', State: { Name: 'running' } },
        { InstanceId: 'i-asg', State: { Name: 'running' }, Tags: [{ Key: 'aws:autoscaling:groupName', Value: 'asg' }] }
      ] }]
    });
    ec2.on(DescribeNetworkInterfacesCommand).resolves({
      NetworkInterfaces: [
        { NetworkInterfaceId: 'eni-free', InterfaceType: 'interface' },
        { NetworkInterfaceId: 'eni-secondary', InterfaceType: 'interface', Attachment: { InstanceId: 'i-web', DeviceIndex: 1 } },
        { NetworkInterfaceId: 'eni-efa', InterfaceType: 'efa' },
        { NetworkInterfaceId: 'eni-primary', InterfaceType: 'interface', Attachment: { InstanceId: 'i-web', DeviceIndex: 0 } },
        { NetworkInterfaceId: 'eni-asg', InterfaceType: 'interface', Attachment: { InstanceId: 'i-asg', DeviceIndex: 1 } },
        { NetworkInterfaceId: 'eni-elb', InterfaceType: 'interface', RequesterManaged: true },
        { NetworkInterfaceId: 'eni-lambda', InterfaceType: 'lambda' },
        { NetworkInterfaceId: 'eni-nat', InterfaceType: 'natGateway' },
        { NetworkInterfaceId: 'eni-operator', InterfaceType: 'interface', Operator: { Managed: true } }
      ]
    });

    const service = await run();

    expect(importIds(service).filter(id => id.startsWith('aws_network_interface'))).toEqual([
      'aws_network_interface:eni-efa',
      'aws_network_interface:eni-free',
      'aws_network_interface:eni-secondary'
    ]);
  });

  it('records a warning and continues when one resource type cannot be listed', async () => {
    ec2.on(DescribeInstancesCommand).rejects(Object.assign(new Error('not authorized'), { name: 'UnauthorizedOperation' }));
    ec2.on(DescribeKeyPairsCommand).resolves({ KeyPairs: [{ KeyName: 'deployer' }] });

    const service = await run();

    expect(importIds(service)).toEqual(['aws_key_pair:deployer']);
    expect(service.getWarnings()[0]).toContain('UnauthorizedOperation');
  });
});
