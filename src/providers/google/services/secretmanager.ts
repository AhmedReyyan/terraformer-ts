import { AssetRule, GoogleService } from '../google-service';

const S = 'secretmanager.googleapis.com/Secret';

/** Secret Manager secrets (global and regional). Secret versions are never imported. */
export class SecretManagerService extends GoogleService {
  protected readonly rules: AssetRule[] = [
    { assetType: S, path: 'projects/*/secrets/*', type: 'google_secret_manager_secret' },
    { assetType: S, path: 'projects/*/locations/*/secrets/*', type: 'google_secret_manager_regional_secret' }
  ];
}
