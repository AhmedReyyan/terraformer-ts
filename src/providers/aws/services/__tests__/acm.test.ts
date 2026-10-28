import { mockClient } from 'aws-sdk-client-mock';
import { ACMClient, ListCertificatesCommand } from '@aws-sdk/client-acm';
import { ACMService } from '../acm';
import { createService, importIds } from './helpers';

const acm = mockClient(ACMClient);

beforeEach(() => acm.reset());

const arn = (id: string) => `arn:aws:acm:us-east-1:123456789012:certificate/${id}`;

describe('ACMService', () => {
  it('lists every key type and live status, skipping service-managed certificates', async () => {
    acm.on(ListCertificatesCommand)
      .resolvesOnce({ CertificateSummaryList: [{ CertificateArn: arn('a'), DomainName: 'example.com' }], NextToken: 'n' })
      .resolves({
        CertificateSummaryList: [
          { CertificateArn: arn('b'), DomainName: 'ec.example.com', KeyAlgorithm: 'EC_prime256v1' },
          { CertificateArn: arn('c'), DomainName: 'cf.example.com', ManagedBy: 'CLOUDFRONT' }
        ]
      });

    const service = createService(ACMService, 'acm');
    await service.initResources();

    expect(importIds(service)).toEqual([`aws_acm_certificate:${arn('a')}`, `aws_acm_certificate:${arn('b')}`]);
    const input = acm.commandCalls(ListCertificatesCommand)[0].args[0].input;
    expect(input.Includes?.keyTypes).toEqual(expect.arrayContaining(['RSA_2048', 'RSA_4096', 'EC_prime256v1', 'EC_secp384r1']));
    expect(input.CertificateStatuses).toEqual(['ISSUED', 'PENDING_VALIDATION', 'INACTIVE', 'EXPIRED']);
    expect(acm.commandCalls(ListCertificatesCommand)[1].args[0].input).toMatchObject({ NextToken: 'n' });
  });
});
