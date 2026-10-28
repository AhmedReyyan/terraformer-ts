import { AssetRule, GoogleAsset, GoogleService, lastSegment } from '../google-service';

const P = 'pubsub.googleapis.com';

/** Pub/Sub topics, subscriptions and schemas. */
export class PubSubService extends GoogleService {
  protected readonly rules: AssetRule[] = [
    { assetType: `${P}/Topic`, path: 'projects/*/topics/*', type: 'google_pubsub_topic' },
    { assetType: `${P}/Subscription`, path: 'projects/*/subscriptions/*', type: 'google_pubsub_subscription' },
    { assetType: `${P}/Schema`, path: 'projects/*/schemas/*', type: 'google_pubsub_schema' }
  ];

  protected skip(asset: GoogleAsset): string | undefined {
    // Eventarc triggers and Pub/Sub-triggered 1st gen functions create their own
    // topics/subscriptions (`eventarc-<region>-<trigger>-...`, `gcf-<function>-...`).
    // Topics/subscriptions with these name prefixes are treated as owned by them.
    const name = lastSegment(asset.path);
    if (asset.assetType !== `${P}/Schema` && /^(eventarc|gcf)-/.test(name)) {
      return 'created by Eventarc or Cloud Functions';
    }
    return undefined;
  }
}
