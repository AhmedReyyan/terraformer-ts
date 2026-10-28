import { AssetRule, GoogleAsset, GoogleService } from '../google-service';

/** Buckets that Google services create for themselves in the project. */
const GOOGLE_BUCKETS = [
  /^gcf-(v2-)?(sources|uploads)-/, // Cloud Functions
  /^(([a-z]+\.)?artifacts|staging)\..+\.appspot\.com$/, // Container Registry, App Engine staging
  /_cloudbuild$/, // Cloud Build
  /^run-sources-/, // Cloud Run source deploys
  /^dataproc-(staging|temp)-/ // Dataproc
];

/** Cloud Storage buckets. Asset name: `//storage.googleapis.com/<bucket>`. */
export class StorageService extends GoogleService {
  protected readonly rules: AssetRule[] = [
    { assetType: 'storage.googleapis.com/Bucket', path: '*', type: 'google_storage_bucket' }
  ];

  protected skip(asset: GoogleAsset): string | undefined {
    return GOOGLE_BUCKETS.some(pattern => pattern.test(asset.path)) ? 'bucket created by a Google service' : undefined;
  }
}
