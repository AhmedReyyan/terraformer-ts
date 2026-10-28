import { mockClient } from 'aws-sdk-client-mock';
import { AccessAnalyzerClient, ListAnalyzersCommand, ListArchiveRulesCommand } from '@aws-sdk/client-accessanalyzer';
import { AccessAnalyzerService } from '../accessanalyzer';
import { createService, importIds } from './helpers';

const aa = mockClient(AccessAnalyzerClient);

beforeEach(() => aa.reset());

const analyzer = (name: string, status: 'ACTIVE' | 'FAILED') => ({
  name, status, arn: `arn:aws:access-analyzer:us-east-1:123456789012:analyzer/${name}`, type: 'ACCOUNT' as const, createdAt: new Date()
});

describe('AccessAnalyzerService', () => {
  it('imports analyzers and archive rules, skipping failed analyzers', async () => {
    aa.on(ListAnalyzersCommand)
      .resolvesOnce({ analyzers: [analyzer('account', 'ACTIVE')], nextToken: 'n' })
      .resolves({ analyzers: [analyzer('broken', 'FAILED')] });
    aa.on(ListArchiveRulesCommand, { analyzerName: 'account' }).resolves({
      archiveRules: [{ ruleName: 'ignore-public', filter: {}, createdAt: new Date(), updatedAt: new Date() }]
    });

    const service = createService(AccessAnalyzerService, 'accessanalyzer');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_accessanalyzer_analyzer:account',
      'aws_accessanalyzer_archive_rule:account/ignore-public'
    ]);
    expect(aa.commandCalls(ListAnalyzersCommand)[1].args[0].input).toMatchObject({ nextToken: 'n' });
    expect(aa.commandCalls(ListArchiveRulesCommand)).toHaveLength(1);
  });
});
