import {
  EC2Client,
  Tag,
  paginateDescribeInstances,
  paginateDescribeVolumes,
  paginateDescribeLaunchTemplates,
  paginateDescribeImages,
  paginateDescribeNetworkInterfaces,
  DescribeKeyPairsCommand,
  DescribeAddressesCommand,
  DescribePlacementGroupsCommand
} from '@aws-sdk/client-ec2';
import { AwsService, tagMap, nameTag } from '../aws-service';

/**
 * Tags marking an instance as owned by another service: Auto Scaling, EC2/Spot Fleet and Karpenter
 * replace these instances themselves, so they are managed through their group/fleet, not aws_instance.
 */
const OWNER_TAGS = ['aws:autoscaling:groupName', 'aws:ec2spot:fleet-request-id', 'aws:ec2:fleet-id', 'karpenter.sh/nodepool'];

/** ENI types a user creates; the others (lambda, nat_gateway, vpc_endpoint, load_balancer, ...) belong to AWS services. */
const USER_ENI_TYPES = new Set(['interface', 'efa', 'efa-only']);

function hasTag(tags: Tag[] | undefined, keys: string[]): boolean {
  return Boolean(tags?.some(tag => tag.Key !== undefined && keys.includes(tag.Key)));
}

export class EC2Service extends AwsService {
  async initResources(): Promise<void> {
    const ec2 = this.client(EC2Client);
    // Instances that are not imported (other owners); their secondary ENIs are skipped too.
    const skippedInstances = new Set<string>();

    await this.collect('EC2 instances', async () => {
      for await (const page of paginateDescribeInstances({ client: ec2 }, {})) {
        for (const reservation of page.Reservations || []) {
          for (const instance of reservation.Instances || []) {
            const id = instance.InstanceId;
            const state = instance.State?.Name;
            if (!id || state === 'terminated' || state === 'shutting-down') {
              continue;
            }
            if (hasTag(instance.Tags, OWNER_TAGS) || instance.Operator?.Managed) {
              skippedInstances.add(id);
              continue;
            }
            this.add('aws_instance', id, nameTag(instance.Tags, id), {
              id,
              instance_type: instance.InstanceType,
              tags: tagMap(instance.Tags)
            });
          }
        }
      }
    });

    await this.collect('EBS volumes', async () => {
      for await (const page of paginateDescribeVolumes({ client: ec2 }, {})) {
        for (const volume of page.Volumes || []) {
          // Only unattached volumes: aws_instance reads every attached volume into its inline
          // root_block_device / ebs_block_device blocks, and the docs forbid mixing those with
          // aws_ebs_volume + aws_volume_attachment for the same instance.
          if (!volume.VolumeId || volume.State !== 'available' || volume.Operator?.Managed) {
            continue;
          }
          this.add('aws_ebs_volume', volume.VolumeId, nameTag(volume.Tags, volume.VolumeId), {
            id: volume.VolumeId,
            tags: tagMap(volume.Tags)
          });
        }
      }
    });

    await this.collect('key pairs', async () => {
      const response = await ec2.send(new DescribeKeyPairsCommand({}));
      for (const key of response.KeyPairs || []) {
        if (key.KeyName) {
          this.add('aws_key_pair', key.KeyName, key.KeyName, {
            name: key.KeyName,
            id: key.KeyPairId,
            tags: tagMap(key.Tags)
          });
        }
      }
    });

    await this.collect('Elastic IPs', async () => {
      const response = await ec2.send(new DescribeAddressesCommand({}));
      for (const address of response.Addresses || []) {
        // EC2-Classic addresses have no allocation ID; service-managed EIPs (ALB/NLB/RNAT) belong to that service.
        if (!address.AllocationId || address.ServiceManaged) {
          continue;
        }
        this.add('aws_eip', address.AllocationId, nameTag(address.Tags, address.PublicIp || address.AllocationId), {
          id: address.AllocationId,
          public_ip: address.PublicIp,
          tags: tagMap(address.Tags)
        });
      }
    });

    await this.collect('launch templates', async () => {
      for await (const page of paginateDescribeLaunchTemplates({ client: ec2 }, {})) {
        for (const template of page.LaunchTemplates || []) {
          // Launch templates created by EKS managed node groups (or service operators) are owned by them.
          if (!template.LaunchTemplateId || hasTag(template.Tags, ['eks:nodegroup-name']) || template.Operator?.Managed) {
            continue;
          }
          this.add('aws_launch_template', template.LaunchTemplateId, template.LaunchTemplateName || template.LaunchTemplateId, {
            id: template.LaunchTemplateId,
            name: template.LaunchTemplateName,
            tags: tagMap(template.Tags)
          });
        }
      }
    });

    await this.collect('AMIs', async () => {
      for await (const page of paginateDescribeImages({ client: ec2 }, { Owners: ['self'] })) {
        for (const image of page.Images || []) {
          // Skip pending/failed/deregistered images.
          if (!image.ImageId || (image.State !== 'available' && image.State !== 'disabled')) {
            continue;
          }
          this.add('aws_ami', image.ImageId, image.Name || image.ImageId, {
            id: image.ImageId,
            name: image.Name,
            tags: tagMap(image.Tags)
          });
        }
      }
    });

    await this.collect('placement groups', async () => {
      const response = await ec2.send(new DescribePlacementGroupsCommand({}));
      for (const group of response.PlacementGroups || []) {
        if (!group.GroupName || group.State === 'deleting' || group.State === 'deleted' || group.Operator?.Managed) {
          continue;
        }
        this.add('aws_placement_group', group.GroupName, group.GroupName, {
          name: group.GroupName,
          id: group.GroupId,
          strategy: group.Strategy,
          tags: tagMap(group.Tags)
        });
      }
    });

    await this.collect('network interfaces', async () => {
      for await (const page of paginateDescribeNetworkInterfaces({ client: ec2 }, {})) {
        for (const eni of page.NetworkInterfaces || []) {
          const id = eni.NetworkInterfaceId;
          const attachment = eni.Attachment;
          if (
            !id ||
            eni.RequesterManaged ||
            eni.Operator?.Managed ||
            !USER_ENI_TYPES.has(eni.InterfaceType || 'interface') ||
            // The primary ENI is created with the instance and lives in aws_instance.primary_network_interface.
            attachment?.DeviceIndex === 0 ||
            (attachment?.InstanceId && skippedInstances.has(attachment.InstanceId))
          ) {
            continue;
          }
          this.add('aws_network_interface', id, nameTag(eni.TagSet, eni.Description || id), {
            id,
            subnet_id: eni.SubnetId,
            tags: tagMap(eni.TagSet)
          });
        }
      }
    });
  }
}
