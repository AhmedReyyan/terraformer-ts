import { AssetRule, GoogleAsset, GoogleService } from '../google-service';

const F = 'cloudfunctions.googleapis.com';

/**
 * Cloud Functions. `CloudFunction` assets are 1st gen functions only; `Function`
 * assets are 1st and 2nd gen, so 1st gen ones are recognized and imported only once.
 */
export class FunctionsService extends GoogleService {
  protected readonly rules: AssetRule[] = [
    {
      assetType: `${F}/CloudFunction`, path: 'projects/*/locations/*/functions/*', type: 'google_cloudfunctions_function',
      id: m => `${m[1]}/${m[2]}/${m[3]}`
    },
    { assetType: `${F}/Function`, path: 'projects/*/locations/*/functions/*', type: 'google_cloudfunctions2_function' }
  ];

  private gen1 = new Set<string>();

  protected prepare(assets: GoogleAsset[]): void {
    for (const asset of assets) {
      if (asset.assetType === `${F}/CloudFunction`) {
        this.gen1.add(asset.path);
      }
    }
  }

  protected skip(asset: GoogleAsset): string | undefined {
    if (asset.assetType === `${F}/Function` &&
      (this.gen1.has(asset.path) || asset.attributes.environment === 'GEN_1')) {
      return '1st gen function (imported from its CloudFunction asset)';
    }
    return undefined;
  }
}

