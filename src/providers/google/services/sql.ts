import { AssetRule, GoogleService } from '../google-service';

/**
 * Cloud SQL instances. Asset name: `//cloudsql.googleapis.com/projects/<p>/instances/<i>`.
 * Databases and users are not in Cloud Asset Inventory and are not imported.
 */
export class SqlService extends GoogleService {
  protected readonly rules: AssetRule[] = [
    { assetType: 'sqladmin.googleapis.com/Instance', path: 'projects/*/instances/*', type: 'google_sql_database_instance' }
  ];
}
