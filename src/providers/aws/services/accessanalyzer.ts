import { AccessAnalyzerClient, paginateListAnalyzers, paginateListArchiveRules } from '@aws-sdk/client-accessanalyzer';
import { mapLimit } from '../../../core/provider';
import { AwsService } from '../aws-service';

/** IAM Access Analyzer analyzers and their archive rules. */
export class AccessAnalyzerService extends AwsService {
  async initResources(): Promise<void> {
    const aa = this.client(AccessAnalyzerClient);
    const analyzers: string[] = [];

    await this.collect('Access Analyzer analyzers', async () => {
      for await (const page of paginateListAnalyzers({ client: aa }, {})) {
        for (const analyzer of page.analyzers || []) {
          // Analyzers that failed to create are skipped.
          if (!analyzer.name || analyzer.status === 'FAILED') {
            continue;
          }
          analyzers.push(analyzer.name);
          this.add('aws_accessanalyzer_analyzer', analyzer.name, analyzer.name, {
            name: analyzer.name,
            arn: analyzer.arn,
            type: analyzer.type,
            tags: { ...(analyzer.tags || {}) }
          });
        }
      }
    });

    await mapLimit(analyzers, 5, analyzer => this.collect(`Access Analyzer ${analyzer} archive rules`, async () => {
      for await (const page of paginateListArchiveRules({ client: aa }, { analyzerName: analyzer })) {
        for (const rule of page.archiveRules || []) {
          if (rule.ruleName) {
            this.add('aws_accessanalyzer_archive_rule', `${analyzer}/${rule.ruleName}`, `${analyzer}-${rule.ruleName}`,
              { analyzer_name: analyzer, rule_name: rule.ruleName });
          }
        }
      }
    }));
  }
}
