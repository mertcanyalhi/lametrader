import { Injectable } from '@nestjs/common';
import { type HealthStatus, ServiceStatus } from './health.types.js';

/**
 * Produces the liveness payload served by {@link HealthController}.
 *
 * Kept as an injectable service (rather than an inline controller return) so the
 * liveness answer has a single, unit-testable home as later checks (Mongo ping,
 * scheduler state) are added.
 */
@Injectable()
export class HealthService {
  /**
   * Report current liveness.
   * Always `ok` for now — the endpoint's job today is to prove the app booted
   * and is accepting requests.
   */
  check(): HealthStatus {
    return { status: ServiceStatus.Ok };
  }
}
