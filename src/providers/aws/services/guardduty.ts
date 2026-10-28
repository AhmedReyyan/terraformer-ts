import {
  GuardDutyClient,
  paginateListDetectors,
  paginateListFilters,
  paginateListIPSets,
  paginateListThreatIntelSets,
  paginateListPublishingDestinations
} from '@aws-sdk/client-guardduty';
import { mapLimit } from '../../../core/provider';
import { AwsService } from '../aws-service';

/** GuardDuty detectors with their filters, IP sets, threat intel sets and publishing destinations. */
export class GuardDutyService extends AwsService {
  async initResources(): Promise<void> {
    const gd = this.client(GuardDutyClient);
    const detectorIds: string[] = [];

    await this.collect('GuardDuty detectors', async () => {
      for await (const page of paginateListDetectors({ client: gd }, {})) {
        for (const id of page.DetectorIds || []) {
          detectorIds.push(id);
          this.add('aws_guardduty_detector', id, `detector-${id}`, { id });
        }
      }
    });

    await mapLimit(detectorIds, 5, async detectorId => {
      await this.collect(`GuardDuty detector ${detectorId} filters`, async () => {
        for await (const page of paginateListFilters({ client: gd }, { DetectorId: detectorId })) {
          for (const name of page.FilterNames || []) {
            this.add('aws_guardduty_filter', `${detectorId}:${name}`, name, { detector_id: detectorId, name });
          }
        }
      });

      await this.collect(`GuardDuty detector ${detectorId} IP sets`, async () => {
        for await (const page of paginateListIPSets({ client: gd }, { DetectorId: detectorId })) {
          for (const id of page.IpSetIds || []) {
            this.add('aws_guardduty_ipset', `${detectorId}:${id}`, `ipset-${id}`, { detector_id: detectorId, id });
          }
        }
      });

      await this.collect(`GuardDuty detector ${detectorId} threat intel sets`, async () => {
        for await (const page of paginateListThreatIntelSets({ client: gd }, { DetectorId: detectorId })) {
          for (const id of page.ThreatIntelSetIds || []) {
            this.add('aws_guardduty_threatintelset', `${detectorId}:${id}`, `threatintelset-${id}`,
              { detector_id: detectorId, id });
          }
        }
      });

      await this.collect(`GuardDuty detector ${detectorId} publishing destinations`, async () => {
        for await (const page of paginateListPublishingDestinations({ client: gd }, { DetectorId: detectorId })) {
          for (const destination of page.Destinations || []) {
            if (destination.DestinationId) {
              this.add('aws_guardduty_publishing_destination', `${detectorId}:${destination.DestinationId}`,
                `destination-${destination.DestinationId}`,
                { detector_id: detectorId, id: destination.DestinationId, destination_type: destination.DestinationType });
            }
          }
        }
      });
    });
  }
}
