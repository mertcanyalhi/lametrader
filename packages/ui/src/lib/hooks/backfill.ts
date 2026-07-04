import { type UseMutationResult, useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiFetch } from '../api-fetch.js';
import type { BackfillJob, StartBackfillInput } from '../backfill.types.js';
import { openJsonSocket } from '../ws/json-socket.js';

/**
 * Start a backfill job for one period (`POST /symbols/:id/backfill`). Returns
 * the created (running) job; the modal then subscribes to its progress via
 * {@link useBackfillJob}. One job per `(symbol, period)`; a duplicate start
 * raises `ApiError` with status `409`, surfaced by the caller.
 *
 * @param id - canonical symbol id to backfill.
 */
export function useStartBackfill(
  id: string,
): UseMutationResult<BackfillJob, Error, StartBackfillInput> {
  return useMutation({
    mutationFn: (input: StartBackfillInput) =>
      apiFetch<BackfillJob>(`/symbols/${id}/backfill`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  });
}

/**
 * Subscribe to a backfill job's live state over its per-job WebSocket
 * (`WS /symbols/:id/backfill/jobs/:jobId/progress`). Returns the latest job
 * frame, or `null` before the first frame (or when `jobId` is `null`). The
 * socket opens on `jobId` change and closes on unmount, so a retry (new job id)
 * transparently re-subscribes.
 *
 * @param id - canonical symbol id.
 * @param jobId - the job to stream, or `null` to subscribe to nothing.
 */
export function useBackfillJob(id: string, jobId: string | null): BackfillJob | null {
  const [job, setJob] = useState<BackfillJob | null>(null);

  useEffect(() => {
    setJob(null);
    if (!jobId) return;
    const socket = openJsonSocket<BackfillJob>(`/symbols/${id}/backfill/jobs/${jobId}/progress`, {
      onFrame: setJob,
    });
    return () => socket.close();
  }, [id, jobId]);

  return job;
}
