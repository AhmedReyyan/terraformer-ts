import { mockClient } from 'aws-sdk-client-mock';
import { ECRPUBLICClient, DescribeRepositoriesCommand, GetRepositoryPolicyCommand } from '@aws-sdk/client-ecr-public';
import { ECRPublicService } from '../ecrpublic';
import { createService, importIds, notFound } from './helpers';

const ecr = mockClient(ECRPUBLICClient);

beforeEach(() => {
  ecr.reset();
  ecr.on(GetRepositoryPolicyCommand).rejects(notFound('RepositoryPolicyNotFoundException'));
});

describe('ECRPublicService', () => {
  it('imports public repositories and their policies in us-east-1', async () => {
    ecr.on(DescribeRepositoriesCommand)
      .resolvesOnce({ repositories: [{ repositoryName: 'tools' }], nextToken: 'n1' })
      .resolvesOnce({ repositories: [{ repositoryName: 'images' }] });
    ecr.on(GetRepositoryPolicyCommand, { repositoryName: 'images' }).resolves({ policyText: '{}' });

    const service = createService(ECRPublicService, 'ecrpublic', 'us-east-1');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_ecrpublic_repository:images',
      'aws_ecrpublic_repository:tools',
      'aws_ecrpublic_repository_policy:images'
    ]);
    expect(service.getWarnings()).toEqual([]);
  });

  it('discovers nothing outside us-east-1', async () => {
    ecr.on(DescribeRepositoriesCommand).resolves({ repositories: [{ repositoryName: 'tools' }] });

    const service = createService(ECRPublicService, 'ecrpublic', 'eu-west-1');
    await service.initResources();

    expect(importIds(service)).toEqual([]);
    expect(service.getWarnings()).toEqual([]);
    expect(ecr.calls()).toHaveLength(0);
  });
});
