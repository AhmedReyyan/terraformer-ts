import { AssetRule, GoogleAsset, GoogleService } from '../google-service';

const B = 'bigquery.googleapis.com';

/** BigQuery datasets, tables (including views) and routines. */
export class BigQueryService extends GoogleService {
  protected readonly rules: AssetRule[] = [
    { assetType: `${B}/Dataset`, path: 'projects/*/datasets/*', type: 'google_bigquery_dataset' },
    {
      assetType: `${B}/Table`, path: 'projects/*/datasets/*/tables/*', type: 'google_bigquery_table',
      name: m => `${m[2]}_${m[3]}`
    },
    {
      assetType: `${B}/Routine`, path: 'projects/*/datasets/*/routines/*', type: 'google_bigquery_routine',
      name: m => `${m[2]}_${m[3]}`
    }
  ];

  protected skip(asset: GoogleAsset): string | undefined {
    // Hidden datasets (`_...`) hold anonymous query results and script temp tables.
    const dataset = /^projects\/[^/]+\/datasets\/([^/]+)/.exec(asset.path)?.[1];
    return dataset?.startsWith('_') ? 'hidden/anonymous dataset' : undefined;
  }
}
