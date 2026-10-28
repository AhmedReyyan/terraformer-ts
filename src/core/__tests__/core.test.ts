import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { parseFilter, applyFilters } from '../filter';
import { sanitizeResourceName, NameAllocator } from '../naming';
import { hclString, renderImportsHcl, renderProviderHcl, renderProviderJson } from '../hcl-generator';
import { BaseProvider, BaseService } from '../provider';
import { Terraformer } from '../terraformer';
import { ProviderData, ResourceConnection, TerraformResource } from '../../types';

const silent = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };

function resource(type: string, id: string, extra: Partial<TerraformResource> = {}): TerraformResource {
  return { type, id, name: id, provider: 'aws', attributes: {}, service: 'svc', ...extra };
}

describe('naming', () => {
  it.each([
    ['My Bucket.prod', 'my_bucket_prod'],
    ['123abc', '_123abc'],
    ['--x--', 'x'],
    ['', 'resource'],
    ['arn:aws:iam::123:role/a', 'arn_aws_iam_123_role_a'],
    ['already_valid-name', 'already_valid-name']
  ])('sanitizes %p to %p', (input, expected) => {
    expect(sanitizeResourceName(input)).toBe(expected);
  });

  it('makes names unique per type', () => {
    const names = new NameAllocator();
    expect(names.allocate('aws_vpc', 'main')).toBe('main');
    expect(names.allocate('aws_vpc', 'Main')).toBe('main_2');
    expect(names.allocate('aws_vpc', 'main')).toBe('main_3');
    expect(names.allocate('aws_subnet', 'main')).toBe('main');
  });
});

describe('filters', () => {
  const resources = [
    resource('aws_s3_bucket', 'a', { service: 's3', attributes: { tags: { Env: 'prod', 'kubernetes.io/cluster/x': 'owned' } } }),
    resource('aws_s3_bucket', 'b', { service: 's3', attributes: { tags: { Env: 'dev' } } }),
    resource('aws_sqs_queue', 'q', { service: 'sqs' })
  ];

  it('keeps only listed IDs of a type, by full type, short type or service name', () => {
    for (const type of ['aws_s3_bucket', 's3_bucket', 's3']) {
      const kept = applyFilters(resources, parseFilter(`${type}=a`));
      expect(kept.map(r => r.id)).toEqual(['a', 'q']);
    }
  });

  it('filters on tag values, including tag keys that contain dots', () => {
    expect(applyFilters(resources, parseFilter('Type=s3;Name=tags.Env;Value=prod:staging')).map(r => r.id)).toEqual(['a', 'q']);
    expect(applyFilters(resources, parseFilter('Name=tags.kubernetes.io/cluster/x')).map(r => r.id)).toEqual(['a']);
  });

  it('splits lists of ARNs correctly', () => {
    const [filter] = parseFilter('aws_iam_policy=arn:aws:iam::1:policy/a:arn:aws:iam::1:policy/b');
    expect(filter.acceptableValues).toEqual(['arn:aws:iam::1:policy/a', 'arn:aws:iam::1:policy/b']);
  });

  it('rejects malformed filters', () => {
    expect(() => parseFilter('Type=s3;Value=x')).toThrow(/Name=/);
    expect(() => parseFilter('Type=s3;Foo=x')).toThrow(/unknown key/);
  });
});

describe('HCL rendering', () => {
  it('escapes quotes, backslashes, control characters and template sequences', () => {
    expect(hclString('a"b\\c\nd${e}%{f}\u0001')).toBe('"a\\"b\\\\c\\nd$${e}%%{f}\\u0001"');
  });

  it('renders import blocks', () => {
    expect(renderImportsHcl([resource('aws_sqs_queue', 'https://q/1', { name: 'q1' })]))
      .toBe('import {\n  to = aws_sqs_queue.q1\n  id = "https://q/1"\n}\n\n');
  });

  it('renders nested provider settings as blocks', () => {
    const data: ProviderData = {
      provider: { azurerm: { features: {}, subscription_id: 'sub' } },
      terraform: { required_providers: [{ azurerm: { source: 'hashicorp/azurerm', version: '~> 4.0' } }] }
    };
    const hcl = renderProviderHcl(data);
    expect(hcl).toContain('provider "azurerm" {\n  features {}\n  subscription_id = "sub"\n}');
    expect(hcl).toContain('source  = "hashicorp/azurerm"');
    expect(JSON.parse(renderProviderJson(data)).terraform.required_providers).toEqual({
      azurerm: { source: 'hashicorp/azurerm', version: '~> 4.0' }
    });
  });
});

class RegionalService extends BaseService {
  async initResources(): Promise<void> {
    this.add('aws_sqs_queue', `queue-${this.config.region}`, 'queue');
    this.add('aws_sqs_queue', `other-${this.config.region}`, 'queue');
  }
}

class GlobalService extends BaseService {
  static readonly global = true;
  async initResources(): Promise<void> {
    this.add('aws_iam_role', 'admin', 'admin');
  }
}

class PartiallyFailingService extends BaseService {
  async initResources(): Promise<void> {
    await this.collect('things', async () => {
      throw Object.assign(new Error('not allowed'), { name: 'AccessDenied' });
    });
    this.add('aws_sns_topic', 'arn:aws:sns:x:1:t', 't');
  }
}

class FakeProvider extends BaseProvider {
  constructor() {
    super('aws', { region: 'us-east-1' }, silent);
  }
  async init(args: string[]): Promise<void> {
    if (args[0]) this.config.region = args[0];
  }
  getSupportedServices(): Record<string, typeof BaseService> {
    return { sqs: RegionalService, queues: RegionalService, iam: GlobalService, sns: PartiallyFailingService };
  }
  getResourceConnections(): ResourceConnection {
    return {};
  }
  getProviderData(): ProviderData {
    return { provider: { aws: { region: this.config.region } } };
  }
  getConfig(): Record<string, any> {
    return {};
  }
}

describe('Terraformer', () => {
  let output: string;

  beforeEach(async () => {
    output = await fs.mkdtemp(path.join(os.tmpdir(), 'terraformer-test-'));
  });

  afterEach(async () => {
    await fs.rm(output, { recursive: true, force: true });
  });

  it('imports regional services per region, global services once, with unique names', async () => {
    const result = await new Terraformer(new FakeProvider(), silent).import({
      resources: ['sqs', 'iam'],
      regions: ['us-east-1', 'eu-west-1'],
      pathOutput: output,
      generate: false
    });

    expect(result.resources.map(r => `${r.region}:${r.type}:${r.id}`).sort()).toEqual([
      'eu-west-1:aws_sqs_queue:other-eu-west-1',
      'eu-west-1:aws_sqs_queue:queue-eu-west-1',
      'us-east-1:aws_iam_role:admin',
      'us-east-1:aws_sqs_queue:other-us-east-1',
      'us-east-1:aws_sqs_queue:queue-us-east-1'
    ]);

    const euImports = await fs.readFile(path.join(output, 'aws', 'eu-west-1', 'sqs', 'imports.tf'), 'utf8');
    expect(euImports).toContain('to = aws_sqs_queue.queue\n');
    expect(euImports).toContain('to = aws_sqs_queue.queue_2\n');
    const euProvider = await fs.readFile(path.join(output, 'aws', 'eu-west-1', 'sqs', 'provider.tf'), 'utf8');
    expect(euProvider).toContain('region = "eu-west-1"');
    await expect(fs.access(path.join(output, 'aws', 'us-east-1', 'iam', 'imports.tf'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(output, 'aws', 'eu-west-1', 'iam'))).rejects.toThrow();
  });

  it('imports each service once for "*" even when it has aliases, and records warnings', async () => {
    const result = await new Terraformer(new FakeProvider(), silent).import({
      resources: ['*'],
      excludes: ['iam'],
      pathOutput: output,
      generate: false,
      compact: true
    });

    expect(result.resources.filter(r => r.type === 'aws_sqs_queue')).toHaveLength(2);
    expect(result.directories).toHaveLength(1);
    expect(result.warnings).toEqual([expect.stringContaining('things: AccessDenied: not allowed')]);
  });

  it('applies filters and warns about unknown services', async () => {
    const result = await new Terraformer(new FakeProvider(), silent).import({
      resources: ['sqs', 'nope'],
      filters: ['aws_sqs_queue=queue-us-east-1'],
      pathOutput: output,
      generate: false
    });

    expect(result.resources.map(r => r.id)).toEqual(['queue-us-east-1']);
    expect(result.warnings).toEqual([expect.stringContaining('unknown service "nope"')]);
  });

  it('writes JSON syntax when requested', async () => {
    await new Terraformer(new FakeProvider(), silent).import({
      resources: ['iam'],
      pathOutput: output,
      output: 'json',
      generate: false
    });
    const imports = JSON.parse(await fs.readFile(path.join(output, 'aws', 'iam', 'imports.tf.json'), 'utf8'));
    expect(imports).toEqual({ import: [{ to: 'aws_iam_role.admin', id: 'admin' }] });
  });
});
