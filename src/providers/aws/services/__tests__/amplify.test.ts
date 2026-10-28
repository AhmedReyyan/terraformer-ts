import { mockClient } from 'aws-sdk-client-mock';
import {
  AmplifyClient,
  ListAppsCommand,
  ListBranchesCommand,
  ListDomainAssociationsCommand,
  ListWebhooksCommand,
  ListBackendEnvironmentsCommand,
  App
} from '@aws-sdk/client-amplify';
import { AmplifyService } from '../amplify';
import { createService, importIds } from './helpers';

const amplify = mockClient(AmplifyClient);

const app = (appId: string, name: string): App => ({ appId, name, appArn: `arn:aws:amplify:us-east-1:1:apps/${appId}` } as App);

beforeEach(() => {
  amplify.reset();
  amplify.on(ListBranchesCommand).resolves({ branches: [] });
  amplify.on(ListDomainAssociationsCommand).resolves({ domainAssociations: [] });
  amplify.on(ListWebhooksCommand).resolves({ webhooks: [] });
  amplify.on(ListBackendEnvironmentsCommand).resolves({ backendEnvironments: [] });
});

describe('AmplifyService', () => {
  it('imports apps and their children by their documented IDs', async () => {
    amplify.on(ListAppsCommand)
      .resolvesOnce({ apps: [{ ...app('d2ypk4k47z8u6', 'web'), tags: { team: 'fe' } }], nextToken: 'p2' })
      .resolvesOnce({ apps: [app('dother', 'docs')] });
    amplify.on(ListBranchesCommand, { appId: 'd2ypk4k47z8u6' }).resolves({
      branches: [{ branchName: 'main', branchArn: 'arn:b' } as any]
    });
    amplify.on(ListDomainAssociationsCommand, { appId: 'd2ypk4k47z8u6' }).resolves({
      domainAssociations: [
        { domainName: 'example.com', domainStatus: 'AVAILABLE' } as any,
        { domainName: 'broken.com', domainStatus: 'FAILED' } as any
      ]
    });
    amplify.on(ListWebhooksCommand, { appId: 'd2ypk4k47z8u6' })
      .resolvesOnce({ webhooks: [{ webhookId: 'a26b22a0-1', branchName: 'main' } as any], nextToken: 'w2' })
      .resolvesOnce({ webhooks: [{ webhookId: 'a26b22a0-2', branchName: 'main' } as any] });
    amplify.on(ListBackendEnvironmentsCommand, { appId: 'd2ypk4k47z8u6' }).resolves({
      backendEnvironments: [{ environmentName: 'prod' } as any]
    });

    const service = createService(AmplifyService, 'amplify');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_amplify_app:d2ypk4k47z8u6',
      'aws_amplify_app:dother',
      'aws_amplify_backend_environment:d2ypk4k47z8u6/prod',
      'aws_amplify_branch:d2ypk4k47z8u6/main',
      'aws_amplify_domain_association:d2ypk4k47z8u6/example.com',
      'aws_amplify_webhook:a26b22a0-1',
      'aws_amplify_webhook:a26b22a0-2'
    ]);
    expect(amplify.commandCalls(ListAppsCommand)[1].args[0].input).toMatchObject({ nextToken: 'p2' });
    expect(amplify.commandCalls(ListWebhooksCommand, { appId: 'd2ypk4k47z8u6' })[1].args[0].input).toMatchObject({ nextToken: 'w2' });
    expect(service.getResources().find(r => r.id === 'd2ypk4k47z8u6')?.attributes.tags).toEqual({ team: 'fe' });
    expect(service.getWarnings()).toEqual([]);
  });
});
