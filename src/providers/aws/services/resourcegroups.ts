import { ResourceGroupsClient, paginateListGroups } from '@aws-sdk/client-resource-groups';
import { AwsService } from '../aws-service';

export class ResourceGroupsService extends AwsService {
  async initResources(): Promise<void> {
    const resourceGroups = this.client(ResourceGroupsClient);

    await this.collect('resource groups', async () => {
      for await (const page of paginateListGroups({ client: resourceGroups }, {})) {
        for (const group of page.GroupIdentifiers || []) {
          const name = group.GroupName;
          // The AWS/aws name prefix is reserved for groups created by AWS services (e.g. AppRegistry applications).
          if (!name || /^aws/i.test(name)) continue;
          this.add('aws_resourcegroups_group', name, name, { name, arn: group.GroupArn });
        }
      }
    });
  }
}
