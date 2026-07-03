import { HealthService } from './health.service.js';
import { ServiceStatus } from './health.types.js';

describe('HealthService', () => {
  it('reports an ok status when checked', () => {
    const service = new HealthService();

    expect(service.check()).toEqual({ status: ServiceStatus.Ok });
  });
});
