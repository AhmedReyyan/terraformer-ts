import {
  ECSClient,
  paginateListClusters,
  paginateListServices,
  paginateListTaskDefinitionFamilies,
  DescribeClustersCommand,
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
  DescribeCapacityProvidersCommand,
  DescribeCapacityProvidersCommandInput,
  Cluster,
  Tag
} from '@aws-sdk/client-ecs';
import { mapLimit } from '../../../core/provider';
import { AwsService } from '../aws-service';

/** Capacity providers that AWS provides in every account; they cannot be managed. */
const AWS_CAPACITY_PROVIDERS = new Set(['FARGATE', 'FARGATE_SPOT']);

/** ECS tags use lower-case `key`/`value`. */
function ecsTags(tags?: Tag[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const tag of tags || []) {
    if (tag.key !== undefined) {
      map[tag.key] = tag.value ?? '';
    }
  }
  return map;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

export class ECSService extends AwsService {
  private ecs!: ECSClient;

  async initResources(): Promise<void> {
    this.ecs = this.client(ECSClient);
    const clusters: Cluster[] = [];

    await this.collect('ECS clusters', async () => {
      const arns: string[] = [];
      for await (const page of paginateListClusters({ client: this.ecs }, {})) {
        arns.push(...(page.clusterArns || []));
      }
      for (const batch of chunks(arns, 100)) {
        const response = await this.ecs.send(new DescribeClustersCommand({ clusters: batch, include: ['TAGS'] }));
        for (const cluster of response.clusters || []) {
          // Skip clusters that are deleted or being deleted, and the clusters AWS Batch creates and owns
          // for its compute environments (named "AWSBatch-<compute environment>-<uuid>").
          if (!cluster.clusterName || cluster.status === 'INACTIVE' || cluster.status === 'DEPROVISIONING' ||
            cluster.clusterName.startsWith('AWSBatch-')) {
            continue;
          }
          clusters.push(cluster);
          const name = cluster.clusterName;
          this.add('aws_ecs_cluster', name, name, { name, arn: cluster.clusterArn, tags: ecsTags(cluster.tags) });
          // aws_ecs_cluster (provider v5+) has no capacity provider arguments; they live in this resource.
          if (cluster.capacityProviders?.length || cluster.defaultCapacityProviderStrategy?.length) {
            this.add('aws_ecs_cluster_capacity_providers', name, name, { cluster_name: name });
          }
        }
      }
    });

    await mapLimit(clusters, 5, cluster => this.collect(`ECS services of ${cluster.clusterName}`, () => this.loadServices(cluster)));

    await this.collect('ECS task definitions', async () => {
      const families: string[] = [];
      for await (const page of paginateListTaskDefinitionFamilies({ client: this.ecs }, { status: 'ACTIVE' })) {
        families.push(...(page.families || []));
      }
      await mapLimit(families, 5, async family => {
        // Without a revision, DescribeTaskDefinition returns the latest ACTIVE revision of the family.
        const response = await this.ecs.send(new DescribeTaskDefinitionCommand({ taskDefinition: family, include: ['TAGS'] }));
        const definition = response.taskDefinition;
        if (definition?.taskDefinitionArn && definition.status === 'ACTIVE') {
          this.add('aws_ecs_task_definition', definition.taskDefinitionArn, family, {
            family,
            revision: definition.revision,
            arn: definition.taskDefinitionArn,
            tags: ecsTags(response.tags)
          });
        }
      });
    });

    await this.collect('ECS capacity providers', async () => {
      const seen = new Set<string>();
      await this.loadCapacityProviders({}, seen);
      // Managed Instances capacity providers are scoped to a cluster and only listed per cluster.
      for (const cluster of clusters) {
        const missing = (cluster.capacityProviders || []).filter(name => !AWS_CAPACITY_PROVIDERS.has(name) && !seen.has(name));
        if (missing.length) {
          await this.loadCapacityProviders({ cluster: cluster.clusterName, capacityProviders: missing }, seen);
        }
      }
    });
  }

  private async loadServices(cluster: Cluster): Promise<void> {
    const clusterName = cluster.clusterName!;
    const arns: string[] = [];
    for await (const page of paginateListServices({ client: this.ecs }, { cluster: cluster.clusterArn || clusterName })) {
      arns.push(...(page.serviceArns || []));
    }
    for (const batch of chunks(arns, 10)) {
      const response = await this.ecs.send(new DescribeServicesCommand({
        cluster: cluster.clusterArn || clusterName,
        services: batch,
        include: ['TAGS']
      }));
      for (const service of response.services || []) {
        // Skip services that are being deleted (DRAINING) or deleted (INACTIVE).
        if (!service.serviceName || service.status !== 'ACTIVE') {
          continue;
        }
        this.add('aws_ecs_service', `${clusterName}/${service.serviceName}`, service.serviceName, {
          name: service.serviceName,
          cluster: clusterName,
          arn: service.serviceArn,
          tags: ecsTags(service.tags)
        });
      }
    }
  }

  private async loadCapacityProviders(input: DescribeCapacityProvidersCommandInput, seen: Set<string>): Promise<void> {
    let nextToken: string | undefined;
    do {
      const response = await this.ecs.send(new DescribeCapacityProvidersCommand({ ...input, include: ['TAGS'], nextToken }));
      for (const provider of response.capacityProviders || []) {
        const name = provider.name;
        if (!name || !provider.capacityProviderArn || seen.has(name)) {
          continue;
        }
        seen.add(name);
        // Skip the AWS-provided Fargate providers and deleted/deleting providers.
        if (AWS_CAPACITY_PROVIDERS.has(name) || provider.type === 'FARGATE' || provider.type === 'FARGATE_SPOT' ||
          provider.status !== 'ACTIVE') {
          continue;
        }
        this.add('aws_ecs_capacity_provider', provider.capacityProviderArn, name, {
          name,
          arn: provider.capacityProviderArn,
          cluster: provider.cluster,
          tags: ecsTags(provider.tags)
        });
      }
      nextToken = response.nextToken;
    } while (nextToken);
  }
}
