import { AssetRule, GoogleAsset, GoogleService } from '../google-service';

/**
 * User-managed service accounts and project custom roles. Service account assets
 * may be named by unique ID; the import ID needs the email, which the search
 * returns in additionalAttributes.email.
 */
export class IamService extends GoogleService {
  protected readonly rules: AssetRule[] = [
    {
      assetType: 'iam.googleapis.com/ServiceAccount', path: 'projects/*/serviceAccounts/*', type: 'google_service_account',
      id: (m, asset) => {
        const email = serviceAccountEmail(m[2], asset);
        return email ? `projects/${m[1]}/serviceAccounts/${email}` : undefined;
      },
      name: (m, asset) => (serviceAccountEmail(m[2], asset) || m[2]).split('@')[0]
    },
    { assetType: 'iam.googleapis.com/Role', path: 'projects/*/roles/*', type: 'google_project_iam_custom_role' }
  ];

  protected skip(asset: GoogleAsset): string | undefined {
    if (asset.assetType !== 'iam.googleapis.com/ServiceAccount') {
      return undefined;
    }
    const email = serviceAccountEmail(asset.path.split('/').pop() || '', asset);
    if (!email) {
      this.warn(`Service account ${asset.name} skipped: its email is not known`);
      return 'no email';
    }
    // Only accounts created by users are named <id>@<project>.iam.gserviceaccount.com.
    // Default accounts (<number>-compute@developer..., <project>@appspot...) and
    // service agents (...@gcp-sa-*.iam...) are created by Google.
    return /^[^@]+@(?!gcp-sa-)[^@]+\.iam\.gserviceaccount\.com$/.test(email)
      ? undefined
      : 'Google-managed or default service account';
  }
}

function serviceAccountEmail(segment: string, asset: GoogleAsset): string | undefined {
  if (segment.includes('@')) {
    return segment;
  }
  const email = asset.attributes.email;
  return typeof email === 'string' && email.includes('@') ? email : undefined;
}
