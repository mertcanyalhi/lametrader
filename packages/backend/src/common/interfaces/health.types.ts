/**
 * The liveness values the health endpoint can report.
 * An enum (not a bare string) per the project convention — a single healthy
 * value today, room to grow (`degraded`, …) without churning callers.
 */
export enum ServiceStatus {
  /** The service is up and serving. */
  Ok = 'ok',
}

/**
 * The `GET /health` response body — a small, stable liveness payload.
 */
export interface HealthStatus {
  /** The current service status. */
  status: ServiceStatus;
}
