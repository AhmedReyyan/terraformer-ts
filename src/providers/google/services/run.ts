import { AssetRule, GoogleService } from '../google-service';

/**
 * Cloud Run services and jobs (v2 resources). Services that back 2nd gen Cloud
 * Functions carry the `goog-managed-by` label and are skipped by the base class.
 */
export class RunService extends GoogleService {
  protected readonly rules: AssetRule[] = [
    { assetType: 'run.googleapis.com/Service', path: 'projects/*/locations/*/services/*', type: 'google_cloud_run_v2_service' },
    { assetType: 'run.googleapis.com/Job', path: 'projects/*/locations/*/jobs/*', type: 'google_cloud_run_v2_job' }
  ];
}
