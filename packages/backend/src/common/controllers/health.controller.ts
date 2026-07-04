import { Controller, Get } from '@nestjs/common';
import type { HealthStatus } from '../interfaces/health.types.js';
import { HealthService } from '../services/health.service.js';

/**
 * Serves `GET /health` — the platform's liveness probe.
 * Delegates to {@link HealthService}; the controller only maps the route.
 */
@Controller('health')
export class HealthController {
  /**
   * @param health - the service producing the liveness payload.
   */
  constructor(private readonly health: HealthService) {}

  /**
   * `GET /health` → `200` with the liveness payload.
   */
  @Get()
  get(): HealthStatus {
    return this.health.check();
  }
}
