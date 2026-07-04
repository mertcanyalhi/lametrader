import { ServiceStatus } from '../interfaces/health.types.js';
import { HealthService } from './health.service.js';

describe('HealthService', () => {
  it('reports an ok status when checked', () => {
    const service = new HealthService();

    expect(service.check()).toEqual({ status: ServiceStatus.Ok });
  });
});
