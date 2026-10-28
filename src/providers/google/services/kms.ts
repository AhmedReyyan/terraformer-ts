import { AssetRule, GoogleService } from '../google-service';

const K = 'cloudkms.googleapis.com';

/** KMS key rings and crypto keys (key versions are never imported). */
export class KmsService extends GoogleService {
  protected readonly rules: AssetRule[] = [
    { assetType: `${K}/KeyRing`, path: 'projects/*/locations/*/keyRings/*', type: 'google_kms_key_ring' },
    // Import ID `{{key_ring}}/cryptoKeys/{{name}}`, key_ring being the key ring's full ID.
    {
      assetType: `${K}/CryptoKey`, path: 'projects/*/locations/*/keyRings/*/cryptoKeys/*', type: 'google_kms_crypto_key',
      name: m => `${m[3]}_${m[4]}`
    }
  ];
}
