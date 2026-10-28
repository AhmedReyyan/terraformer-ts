import { mockClient } from 'aws-sdk-client-mock';
import {
  CodeCommitClient,
  ListRepositoriesCommand,
  ListApprovalRuleTemplatesCommand,
  ListRepositoriesForApprovalRuleTemplateCommand
} from '@aws-sdk/client-codecommit';
import { CodeCommitService } from '../codecommit';
import { createService, importIds } from './helpers';

const codecommit = mockClient(CodeCommitClient);

beforeEach(() => {
  codecommit.reset();
  codecommit.on(ListRepositoriesCommand).resolves({});
  codecommit.on(ListApprovalRuleTemplatesCommand).resolves({});
  codecommit.on(ListRepositoriesForApprovalRuleTemplateCommand).resolves({});
});

describe('CodeCommitService', () => {
  it('imports repositories, approval rule templates and their associations', async () => {
    codecommit.on(ListRepositoriesCommand).resolvesOnce({
      repositories: [{ repositoryName: 'app', repositoryId: 'r1' }], nextToken: 'n2'
    }).resolvesOnce({
      repositories: [{ repositoryName: 'infra', repositoryId: 'r2' }]
    });
    codecommit.on(ListApprovalRuleTemplatesCommand).resolves({ approvalRuleTemplateNames: ['two-approvers'] });
    codecommit.on(ListRepositoriesForApprovalRuleTemplateCommand, { approvalRuleTemplateName: 'two-approvers' })
      .resolvesOnce({ repositoryNames: ['app'], nextToken: 'a2' })
      .resolvesOnce({ repositoryNames: ['infra'] });

    const service = createService(CodeCommitService, 'codecommit');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_codecommit_approval_rule_template:two-approvers',
      'aws_codecommit_approval_rule_template_association:two-approvers,app',
      'aws_codecommit_approval_rule_template_association:two-approvers,infra',
      'aws_codecommit_repository:app',
      'aws_codecommit_repository:infra'
    ]);
    expect(codecommit.commandCalls(ListRepositoriesCommand)[1].args[0].input).toMatchObject({ nextToken: 'n2' });
    expect(service.getWarnings()).toEqual([]);
  });
});
