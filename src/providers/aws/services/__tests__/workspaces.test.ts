import { mockClient } from 'aws-sdk-client-mock';
import {
  WorkSpacesClient,
  DescribeWorkspaceDirectoriesCommand,
  DescribeWorkspacesCommand,
  DescribeIpGroupsCommand
} from '@aws-sdk/client-workspaces';
import { WorkSpacesService } from '../workspaces';
import { createService, importIds } from './helpers';

const workspaces = mockClient(WorkSpacesClient);

beforeEach(() => {
  workspaces.reset();
});

describe('WorkSpacesService', () => {
  it('imports directories, workspaces and IP groups, skipping terminated and deregistered ones', async () => {
    workspaces.on(DescribeWorkspaceDirectoriesCommand).resolves({
      Directories: [
        { DirectoryId: 'd-1111111111', DirectoryName: 'corp.example.com', State: 'REGISTERED' },
        { DirectoryId: 'd-2222222222', State: 'DEREGISTERING' },
        { DirectoryId: 'd-3333333333', State: 'ERROR' }
      ]
    });
    workspaces.on(DescribeWorkspacesCommand)
      .resolvesOnce({ Workspaces: [{ WorkspaceId: 'ws-aaa', UserName: 'alice', State: 'AVAILABLE' }], NextToken: 't' })
      .resolvesOnce({
        Workspaces: [
          { WorkspaceId: 'ws-bbb', State: 'STOPPED' },
          { WorkspaceId: 'ws-ccc', State: 'TERMINATING' },
          { WorkspaceId: 'ws-ddd', State: 'TERMINATED' }
        ]
      });
    workspaces.on(DescribeIpGroupsCommand)
      .resolvesOnce({ Result: [{ groupId: 'wsipg-1', groupName: 'office' }], NextToken: 'n' })
      .resolvesOnce({ Result: [{ groupId: 'wsipg-2' }] });

    const service = createService(WorkSpacesService, 'workspaces');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_workspaces_directory:d-1111111111',
      'aws_workspaces_ip_group:wsipg-1',
      'aws_workspaces_ip_group:wsipg-2',
      'aws_workspaces_workspace:ws-aaa',
      'aws_workspaces_workspace:ws-bbb'
    ]);
    expect(workspaces.commandCalls(DescribeIpGroupsCommand)[1].args[0].input).toMatchObject({ NextToken: 'n' });
    expect(workspaces.commandCalls(DescribeWorkspacesCommand)[1].args[0].input).toMatchObject({ NextToken: 't' });
    expect(service.getWarnings()).toEqual([]);
  });
});
