import { BaseService } from '../../../../core/provider';
import { ConsoleLogger } from '../../../../core/logger';

const silentLogger = new ConsoleLogger(false);
silentLogger.warn = () => {};
silentLogger.info = () => {};

/** Instantiate an AWS service the same way AWSProvider.initService does. */
export function createService<T extends BaseService>(
  ServiceClass: new (...args: any[]) => T,
  serviceName: string,
  region: string = 'us-east-1'
): T {
  return new ServiceClass('aws', serviceName, {
    region,
    credentials: { accessKeyId: 'AKIDTEST', secretAccessKey: 'secret' }
  }, silentLogger);
}

/** `type:importId` for every discovered resource, sorted, for compact assertions. */
export function importIds(service: BaseService): string[] {
  return service.getResources().map(r => `${r.type}:${r.id}`).sort();
}

/** An error shaped like the SDK's 404 / NoSuch* service exceptions. */
export function notFound(name: string = 'ResourceNotFoundException'): Error {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: 404 } });
}
