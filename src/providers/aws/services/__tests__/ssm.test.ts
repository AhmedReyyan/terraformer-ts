import { mockClient } from 'aws-sdk-client-mock';
import {
  SSMClient,
  DescribeParametersCommand,
  ListDocumentsCommand,
  DescribeMaintenanceWindowsCommand,
  DescribeMaintenanceWindowTargetsCommand,
  DescribeMaintenanceWindowTasksCommand,
  ListAssociationsCommand,
  DescribePatchBaselinesCommand,
  DescribePatchGroupsCommand
} from '@aws-sdk/client-ssm';
import { SSMService } from '../ssm';
import { createService, importIds } from './helpers';

const ssm = mockClient(SSMClient);

beforeEach(() => ssm.reset());

describe('SSMService', () => {
  it('imports every SSM resource type with its import ID', async () => {
    ssm.on(DescribeParametersCommand)
      .resolvesOnce({ Parameters: [{ Name: '/app/db/url', Type: 'String' }], NextToken: 'p2' })
      .resolves({ Parameters: [{ Name: 'plain', Type: 'SecureString', Tier: 'Advanced' }] });
    ssm.on(ListDocumentsCommand).resolves({ DocumentIdentifiers: [{ Name: 'my-doc', DocumentType: 'Command' }] });
    ssm.on(DescribeMaintenanceWindowsCommand).resolves({ WindowIdentities: [{ WindowId: 'mw-1', Name: 'nightly' }] });
    ssm.on(DescribeMaintenanceWindowTargetsCommand).resolves({ Targets: [{ WindowTargetId: 'tgt-1', Name: 'web' }] });
    ssm.on(DescribeMaintenanceWindowTasksCommand).resolves({ Tasks: [{ WindowTaskId: 'task-1' }] });
    ssm.on(ListAssociationsCommand).resolves({ Associations: [{ AssociationId: 'assoc-1', Name: 'AWS-RunPatchBaseline' }] });
    ssm.on(DescribePatchBaselinesCommand).resolves({ BaselineIdentities: [{ BaselineId: 'pb-1', BaselineName: 'custom' }] });
    ssm.on(DescribePatchGroupsCommand).resolves({ Mappings: [{ PatchGroup: 'web', BaselineIdentity: { BaselineId: 'pb-1' } }] });

    const service = createService(SSMService, 'ssm');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_ssm_association:assoc-1',
      'aws_ssm_document:my-doc',
      'aws_ssm_maintenance_window:mw-1',
      'aws_ssm_maintenance_window_target:mw-1/tgt-1',
      'aws_ssm_maintenance_window_task:mw-1/task-1',
      'aws_ssm_parameter:/app/db/url',
      'aws_ssm_parameter:plain',
      'aws_ssm_patch_baseline:pb-1',
      'aws_ssm_patch_group:web,pb-1'
    ]);
    expect(ssm.commandCalls(DescribeParametersCommand)[1].args[0].input).toMatchObject({ NextToken: 'p2' });
    // AWS-owned documents and predefined baselines are excluded server-side.
    expect(ssm.commandCalls(ListDocumentsCommand)[0].args[0].input).toMatchObject({ Filters: [{ Key: 'Owner', Values: ['Self'] }] });
    expect(ssm.commandCalls(DescribePatchBaselinesCommand)[0].args[0].input).toMatchObject({ Filters: [{ Key: 'OWNER', Values: ['Self'] }] });
    expect(service.getWarnings()).toEqual([]);
  });
});
