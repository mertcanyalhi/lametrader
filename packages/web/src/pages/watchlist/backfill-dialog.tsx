import type { Period } from '@lametrader/core';
import { Button, Code, Dialog, Flex, Progress, Spinner, Text, TextField } from '@radix-ui/themes';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FieldLabel } from '../../components/field-label.js';
import { PeriodToggleGroup } from '../../components/period-toggle-group.js';
import { ApiError } from '../../lib/api-fetch.js';
import { BackfillJobStatus, type BackfillProgress } from '../../lib/backfill.types.js';
import { useBackfillJob, useStartBackfill } from '../../lib/hooks/backfill.js';
import { WATCHLIST_QUERY_KEY } from '../../lib/hooks/symbols.js';
import { getLogger } from '../../lib/log.js';
import { sortPeriods } from '../../lib/periods.js';

/** Scoped logger for the backfill flow. */
const log = getLogger('backfill-dialog');

/** Progress as a 0–100 percentage for the determinate bar. */
function percent(progress: BackfillProgress | null): number {
  if (!progress || progress.total <= 0) return 0;
  return Math.round((progress.saved / progress.total) * 100);
}

/**
 * The per-symbol backfill modal: pick one or more of the symbol's watched
 * periods and an optional date range, start a job per period, and watch each
 * job's live progress over its WebSocket — resolving to a success summary or a
 * failure with Retry. A `409` (already running) start surfaces inline.
 *
 * Opened from the row's Backfill action and auto-opened after a successful add.
 *
 * @param id - canonical symbol id to backfill.
 * @param periods - the symbol's watched periods (the selectable options).
 * @param open - controlled open state.
 * @param onOpenChange - controlled open-state setter.
 */
export function BackfillDialog({
  id,
  periods,
  open,
  onOpenChange,
}: {
  id: string;
  periods: Period[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactNode {
  const start = useStartBackfill(id);
  const [selected, setSelected] = useState<Period[]>(periods);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  // Per-period outcomes of a start: the running job's id, or a start error.
  const [jobIds, setJobIds] = useState<Partial<Record<Period, string>>>({});
  const [startErrors, setStartErrors] = useState<Partial<Record<Period, string>>>({});

  // Re-seed the form and clear any prior run each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setSelected(periods);
    setFromDate('');
    setToDate('');
    setJobIds({});
    setStartErrors({});
  }, [open, periods]);

  function range(): { from?: number; to?: number } {
    const from = fromDate ? new Date(fromDate).getTime() : undefined;
    const to = toDate ? new Date(toDate).getTime() : undefined;
    return { ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) };
  }

  async function startPeriod(period: Period): Promise<void> {
    setStartErrors((errors) => ({ ...errors, [period]: undefined }));
    try {
      const job = await start.mutateAsync({ period, ...range() });
      setJobIds((ids) => ({ ...ids, [period]: job.id }));
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : 'failed to start backfill';
      log.warn({ err: cause, id, period }, 'start backfill failed');
      setStartErrors((errors) => ({ ...errors, [period]: message }));
    }
  }

  async function handleStart(): Promise<void> {
    await Promise.all(selected.map(startPeriod));
  }

  const startedPeriods = sortPeriods(
    periods.filter((period) => jobIds[period] || startErrors[period]),
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="520px">
        <Dialog.Title>Backfill history</Dialog.Title>
        <Dialog.Description size="2" color="gray">
          Fetch historical candles for <Code>{id}</Code>. Leave the range empty for the deepest
          available history.
        </Dialog.Description>

        <Flex direction="column" gap="5" mt="4">
          <section className="flex flex-col gap-2">
            <FieldLabel
              htmlFor="backfill-periods-bar"
              label="Periods"
              hintLabel="About backfill periods"
              hint="A backfill runs per timeframe. Pick which of this symbol's watched periods to fetch history for."
            />
            <PeriodToggleGroup
              id="backfill-periods-bar"
              options={sortPeriods(periods)}
              value={selected}
              disabled={start.isPending}
              onValueChange={setSelected}
            />
          </section>

          <section className="flex flex-col gap-2">
            <FieldLabel
              label="Range (optional)"
              hintLabel="About the backfill range"
              hint="Limit the backfill to a date range. Leave both empty to fetch the provider's deepest available history."
            />
            <Flex gap="3" align="center">
              <TextField.Root
                type="date"
                aria-label="From date"
                value={fromDate}
                disabled={start.isPending}
                onChange={(event) => setFromDate(event.target.value)}
              />
              <Text size="2" color="gray">
                to
              </Text>
              <TextField.Root
                type="date"
                aria-label="To date"
                value={toDate}
                disabled={start.isPending}
                onChange={(event) => setToDate(event.target.value)}
              />
            </Flex>
          </section>

          {startedPeriods.length > 0 ? (
            <Flex direction="column" gap="3">
              {startedPeriods.map((period) => (
                <BackfillPeriodProgress
                  key={period}
                  id={id}
                  period={period}
                  jobId={jobIds[period] ?? null}
                  startError={startErrors[period]}
                  onRetry={() => startPeriod(period)}
                />
              ))}
            </Flex>
          ) : null}
        </Flex>

        <Flex gap="3" mt="5" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray">
              Close
            </Button>
          </Dialog.Close>
          <Button onClick={handleStart} disabled={selected.length === 0 || start.isPending}>
            Start backfill
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/**
 * One period's backfill state: a determinate progress bar while running, a
 * success summary on completion (with a toast + watchlist invalidation), or an
 * error with a Retry — covering both a failed job and a start error (e.g. a
 * `409` before any job exists).
 */
function BackfillPeriodProgress({
  id,
  period,
  jobId,
  startError,
  onRetry,
}: {
  id: string;
  period: Period;
  jobId: string | null;
  startError: string | undefined;
  onRetry: () => void;
}): ReactNode {
  const job = useBackfillJob(id, jobId);
  const queryClient = useQueryClient();
  // Fire the success side effects once per job id (not on every re-render).
  const handledJobId = useRef<string | null>(null);

  useEffect(() => {
    if (job?.status === BackfillJobStatus.Succeeded && handledJobId.current !== jobId) {
      handledJobId.current = jobId;
      toast.success(`Backfilled ${period} for ${id}`);
      // Candles now exist, which can change the enriched snapshot quote.
      queryClient.invalidateQueries({ queryKey: WATCHLIST_QUERY_KEY });
    }
  }, [job, jobId, period, id, queryClient]);

  return (
    <div className="flex flex-col gap-1">
      <Text size="2" weight="medium">
        {period}
      </Text>
      <PeriodState period={period} job={job} startError={startError} onRetry={onRetry} />
    </div>
  );
}

/** Renders the inner state of one period's backfill (start error / connecting / running / done). */
function PeriodState({
  period,
  job,
  startError,
  onRetry,
}: {
  period: Period;
  job: ReturnType<typeof useBackfillJob>;
  startError: string | undefined;
  onRetry: () => void;
}): ReactNode {
  if (startError) {
    return <RetryableError message={startError} onRetry={onRetry} />;
  }
  if (!job) {
    return (
      <Flex align="center" gap="2">
        <Spinner />
        <Text size="2" color="gray">
          Starting…
        </Text>
      </Flex>
    );
  }
  if (job.status === BackfillJobStatus.Failed) {
    return (
      <RetryableError message={job.error ?? `backfill failed for ${period}`} onRetry={onRetry} />
    );
  }
  if (job.status === BackfillJobStatus.Succeeded) {
    return (
      <Text size="2" color="green">
        Saved {job.summary?.saved ?? 0} candles
        {job.summary && !job.summary.complete ? ' (more history may exist)' : ''}
      </Text>
    );
  }
  return (
    <Flex align="center" gap="2">
      <Progress value={percent(job.progress)} className="flex-1" />
      <Text size="1" color="gray" className="tabular-nums">
        {job.progress?.saved ?? 0} / {job.progress?.total ?? 0}
      </Text>
    </Flex>
  );
}

/** An error message paired with a Retry button. */
function RetryableError({ message, onRetry }: { message: string; onRetry: () => void }): ReactNode {
  return (
    <Flex align="center" justify="between" gap="3">
      <Text size="2" color="red" role="alert">
        {message}
      </Text>
      <Button size="1" variant="soft" onClick={onRetry}>
        Retry
      </Button>
    </Flex>
  );
}
