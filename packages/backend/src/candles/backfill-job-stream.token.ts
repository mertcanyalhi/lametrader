/**
 * DI token for the per-job backfill progress stream — a
 * {@link import('./stream-hub.js').StreamHub}<{@link import('./backfill-job.types.js').BackfillJob}>
 * keyed by job id.
 *
 * The {@link import('./backfill-job.service.js').BackfillJobService} publishes
 * each job snapshot to it via its `onUpdate` listener, and the
 * {@link import('./backfill-progress.gateway.js').BackfillProgressGateway}
 * subscribes a WebSocket to it — so the application stays transport-agnostic
 * (ADR-0005 / ADR-0008). A string token because `StreamHub<BackfillJob>` is a
 * generic with no distinct runtime value to inject by type.
 */
export const BACKFILL_JOB_STREAM = 'BACKFILL_JOB_STREAM';
