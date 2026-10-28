import {
  WorkSpacesClient,
  DescribeIpGroupsCommand,
  paginateDescribeWorkspaceDirectories,
  paginateDescribeWorkspaces
} from '@aws-sdk/client-workspaces';
import { AwsService } from '../aws-service';

const SKIPPED_DIRECTORY_STATES = new Set(['DEREGISTERING', 'DEREGISTERED', 'ERROR']);
const SKIPPED_WORKSPACE_STATES = new Set(['TERMINATING', 'TERMINATED']);

export class WorkSpacesService extends AwsService {
  async initResources(): Promise<void> {
    const workspaces = this.client(WorkSpacesClient);

    await this.collect('WorkSpaces directories', async () => {
      for await (const page of paginateDescribeWorkspaceDirectories({ client: workspaces }, {})) {
        for (const directory of page.Directories || []) {
          // Directories being deregistered or that failed to register are skipped.
          if (directory.DirectoryId && !SKIPPED_DIRECTORY_STATES.has(directory.State || '')) {
            this.add('aws_workspaces_directory', directory.DirectoryId, directory.DirectoryName || directory.DirectoryId, {
              id: directory.DirectoryId, name: directory.DirectoryName
            });
          }
        }
      }
    });

    await this.collect('WorkSpaces workspaces', async () => {
      for await (const page of paginateDescribeWorkspaces({ client: workspaces }, {})) {
        for (const workspace of page.Workspaces || []) {
          if (workspace.WorkspaceId && !SKIPPED_WORKSPACE_STATES.has(workspace.State || '')) {
            const name = workspace.UserName ? `${workspace.UserName}-${workspace.WorkspaceId}` : workspace.WorkspaceId;
            this.add('aws_workspaces_workspace', workspace.WorkspaceId, name, {
              id: workspace.WorkspaceId,
              user_name: workspace.UserName,
              directory_id: workspace.DirectoryId,
              computer_name: workspace.ComputerName
            });
          }
        }
      }
    });

    await this.collect('WorkSpaces IP groups', async () => {
      let NextToken: string | undefined;
      do {
        const page = await workspaces.send(new DescribeIpGroupsCommand({ NextToken }));
        for (const group of page.Result || []) {
          if (group.groupId) {
            this.add('aws_workspaces_ip_group', group.groupId, group.groupName || group.groupId, {
              id: group.groupId, name: group.groupName
            });
          }
        }
        NextToken = page.NextToken;
      } while (NextToken);
    });
  }
}
