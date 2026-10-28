import {
  CodeCommitClient,
  paginateListRepositories,
  paginateListApprovalRuleTemplates,
  paginateListRepositoriesForApprovalRuleTemplate
} from '@aws-sdk/client-codecommit';
import { mapLimit } from '../../../core/provider';
import { AwsService } from '../aws-service';

export class CodeCommitService extends AwsService {
  async initResources(): Promise<void> {
    const codecommit = this.client(CodeCommitClient);

    // aws_codecommit_trigger is not imported: the provider does not support importing it.
    await this.collect('CodeCommit repositories', async () => {
      for await (const page of paginateListRepositories({ client: codecommit }, {})) {
        for (const repo of page.repositories || []) {
          const name = repo.repositoryName!;
          this.add('aws_codecommit_repository', name, name, { name, repository_id: repo.repositoryId });
        }
      }
    });

    const templates: string[] = [];
    await this.collect('CodeCommit approval rule templates', async () => {
      for await (const page of paginateListApprovalRuleTemplates({ client: codecommit }, {})) {
        for (const name of page.approvalRuleTemplateNames || []) {
          templates.push(name);
          this.add('aws_codecommit_approval_rule_template', name, name, { name });
        }
      }
    });

    await mapLimit(templates, 5, template =>
      this.collect(`CodeCommit repositories of approval rule template ${template}`, async () => {
        const pages = paginateListRepositoriesForApprovalRuleTemplate({ client: codecommit }, { approvalRuleTemplateName: template });
        for await (const page of pages) {
          for (const repository of page.repositoryNames || []) {
            this.add('aws_codecommit_approval_rule_template_association', `${template},${repository}`, `${template}_${repository}`, {
              approval_rule_template_name: template,
              repository_name: repository
            });
          }
        }
      })
    );
  }
}
