import { ACMClient, paginateListCertificates, KeyAlgorithm, CertificateStatus } from '@aws-sdk/client-acm';
import { AwsService } from '../aws-service';

/**
 * Statuses worth managing. FAILED, VALIDATION_TIMED_OUT and REVOKED certificates
 * are dead and skipped.
 */
const STATUSES: CertificateStatus[] = ['ISSUED', 'PENDING_VALIDATION', 'INACTIVE', 'EXPIRED'];

/** ACM certificates (Amazon issued, private CA and imported). */
export class ACMService extends AwsService {
  async initResources(): Promise<void> {
    const acm = this.client(ACMClient);

    await this.collect('ACM certificates', async () => {
      const input = {
        CertificateStatuses: STATUSES,
        // Without keyTypes ListCertificates only returns RSA_2048 certificates.
        Includes: { keyTypes: Object.values(KeyAlgorithm) }
      };
      for await (const page of paginateListCertificates({ client: acm }, input)) {
        for (const certificate of page.CertificateSummaryList || []) {
          // Certificates managed by another service (ManagedBy, e.g. CLOUDFRONT) are skipped.
          if (!certificate.CertificateArn || certificate.ManagedBy) {
            continue;
          }
          const name = certificate.DomainName || certificate.CertificateArn.split('/').pop()!;
          this.add('aws_acm_certificate', certificate.CertificateArn, name, {
            arn: certificate.CertificateArn,
            domain_name: certificate.DomainName,
            status: certificate.Status,
            type: certificate.Type,
            key_algorithm: certificate.KeyAlgorithm
          });
        }
      }
    });
  }
}
