import type { Period } from '@lametrader/core';
import {
  Button,
  Checkbox,
  Code,
  Dialog,
  Flex,
  Progress,
  Spinner,
  Text,
  TextField,
} from '@radix-ui/themes';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '../../lib/api-fetch.js';
import {
  type BackfillJob,
  BackfillJobStatus,
  type BackfillProgress,
} from '../../lib/backfill.types.js';
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

/** A backfilled candle `time` (epoch ms) as a calendar date and time. */
function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** A job is in flight while it has been started but hasn't reached a terminal status. */
function isActive(status: BackfillJobStatus | undefined): boolean {
  return status !== BackfillJobStatus.Succeeded && status !== BackfillJobStatus.Failed;
}

/**
 * Validate the date range when it's enabled (the "Longest available period"
 * checkbox is off): both ends must be filled and ordered. Returns the message
 * to show, or `null` when the range is valid (or not in use).
 */
function rangeErrorFor(longestAvailable: boolean, fromDate: string, toDate: string): string | null {
  if (longestAvailable) return null;
  if (!fromDate || !toDate) {
    return 'Enter a start and end date, or use the longest available period.';
  }
  if (new Date(fromDate).getTime() > new Date(toDate).getTime()) {
    return 'The start date must be on or before the end date.';
  }
  return null;
}

/**
 * The per-symbol backfill modal: the symbol's watched periods are listed one per
 * row with a checkbox to include them and their live progress shown beside each.
 * Starting issues one job per selected period (`POST /symbols/:id/backfill`) and
 * streams progress over each per-job WebSocket to a success summary (with the
 * backfilled date range) or a failure with Retry. A `409` (already running)
 * surfaces inline. While any job is running, Start is disabled and shows a
 * loading indicator; once every selected period has succeeded, Start is hidden
 * and only Close remains. The date range is opt-in behind "Longest available period".
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
  const [longestAvailable, setLongestAvailable] = useState(true);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  // Per-period outcomes of a start: the running job's id, or a start error.
  const [jobIds, setJobIds] = useState<Partial<Record<Period, string>>>({});
  const [startErrors, setStartErrors] = useState<Partial<Record<Period, string>>>({});
  // Live status per period, reported up by each progress child (drives Start's disabled state).
  const [statuses, setStatuses] = useState<Partial<Record<Period, BackfillJobStatus>>>({});

  // Re-seed the form and clear any prior run each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setSelected(periods);
    setLongestAvailable(true);
    setFromDate('');
    setToDate('');
    setJobIds({});
    setStartErrors({});
    setStatuses({});
  }, [open, periods]);

  const reportStatus = useCallback((period: Period, status: BackfillJobStatus | undefined) => {
    setStatuses((prev) => ({ ...prev, [period]: status }));
  }, []);

  const options = sortPeriods(periods);
  const inProgress =
    start.isPending || options.some((period) => jobIds[period] && isActive(statuses[period]));
  // Every selected period has finished successfully — nothing left to start.
  const completed =
    selected.length > 0 &&
    selected.every((period) => statuses[period] === BackfillJobStatus.Succeeded);
  const rangeError = rangeErrorFor(longestAvailable, fromDate, toDate);

  function range(): { from?: number; to?: number } {
    if (longestAvailable) return {};
    const from = fromDate ? new Date(fromDate).getTime() : undefined;
    const to = toDate ? new Date(toDate).getTime() : undefined;
    return { ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) };
  }

  function togglePeriod(period: Period, checked: boolean): void {
    setSelected((current) =>
      checked ? [...current, period] : current.filter((value) => value !== period),
    );
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
    if (rangeError) return;
    await Promise.all(selected.map(startPeriod));
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="520px">
        <Dialog.Title>Backfill history</Dialog.Title>
        <Dialog.Description size="2" color="gray">
          Fetch historical candles for <Code>{id}</Code>.
        </Dialog.Description>

        <Flex direction="column" gap="5" mt="4">
          <section className="flex flex-col gap-2">
            <Text as="label" size="2" weight="medium" className="flex items-center gap-2">
              <Checkbox
                checked={longestAvailable}
                disabled={inProgress}
                onCheckedChange={(checked) => setLongestAvailable(checked === true)}
              />
              Longest available period
            </Text>
            {longestAvailable ? null : (
              <Flex gap="3" align="center">
                <TextField.Root
                  type="date"
                  aria-label="From date"
                  className="w-40"
                  value={fromDate}
                  disabled={inProgress}
                  onChange={(event) => setFromDate(event.target.value)}
                />
                <Text size="2" color="gray">
                  to
                </Text>
                <TextField.Root
                  type="date"
                  aria-label="To date"
                  className="w-40"
                  value={toDate}
                  disabled={inProgress}
                  onChange={(event) => setToDate(event.target.value)}
                />
              </Flex>
            )}
            {rangeError ? (
              <Text size="1" color="red" role="alert">
                {rangeError}
              </Text>
            ) : null}
          </section>

          <section className="flex flex-col gap-2">
            <Text size="2" weight="medium">
              Periods
            </Text>
            <Flex direction="column" gap="2">
              {options.map((period) => (
                <Flex key={period} align="center" justify="between" gap="3">
                  <Text as="label" size="2" className="flex items-center gap-2">
                    <Checkbox
                      checked={selected.includes(period)}
                      disabled={inProgress}
                      onCheckedChange={(checked) => togglePeriod(period, checked === true)}
                    />
                    {period}
                  </Text>
                  <div className="min-w-0 flex-1">
                    <PeriodStatus
                      id={id}
                      period={period}
                      jobId={jobIds[period] ?? null}
                      startError={startErrors[period]}
                      onStatus={reportStatus}
                      onRetry={() => startPeriod(period)}
                    />
                  </div>
                </Flex>
              ))}
            </Flex>
          </section>
        </Flex>

        <Flex gap="3" mt="5" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray">
              Close
            </Button>
          </Dialog.Close>
          {completed ? null : (
            <Button
              onClick={handleStart}
              disabled={selected.length === 0 || inProgress || rangeError !== null}
              loading={inProgress}
            >
              Start backfill
            </Button>
          )}
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/**
 * The progress shown beside one period: nothing before a start, an inline error
 * with Retry for a start failure (e.g. a `409`), or — once a job exists — its
 * live state via the per-job WebSocket. Reports its status up so the dialog can
 * gate Start, and fires the success toast + watchlist invalidation once.
 */
function PeriodStatus({
  id,
  period,
  jobId,
  startError,
  onStatus,
  onRetry,
}: {
  id: string;
  period: Period;
  jobId: string | null;
  startError: string | undefined;
  onStatus: (period: Period, status: BackfillJobStatus | undefined) => void;
  onRetry: () => void;
}): ReactNode {
  const job = useBackfillJob(id, jobId);
  const queryClient = useQueryClient();
  const handledJobId = useRef<string | null>(null);

  useEffect(() => {
    onStatus(period, job?.status);
    if (job?.status === BackfillJobStatus.Succeeded && handledJobId.current !== jobId) {
      handledJobId.current = jobId;
      toast.success(`Backfilled ${period} for ${id}`);
      // Candles now exist, which can change the enriched snapshot quote.
      queryClient.invalidateQueries({ queryKey: WATCHLIST_QUERY_KEY });
    }
  }, [job, jobId, period, id, queryClient, onStatus]);

  if (startError) {
    return <RetryableError message={startError} onRetry={onRetry} />;
  }
  if (!jobId) {
    return null;
  }
  if (!job) {
    return (
      <Flex align="center" justify="end" gap="2">
        <Spinner size="1" />
        <Text size="1" color="gray">
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
    return <SuccessSummary job={job} />;
  }
  return (
    <Flex align="center" justify="end" gap="2">
      <Progress value={percent(job.progress)} className="w-32" />
      <Text size="1" color="gray" className="tabular-nums">
        {job.progress?.saved ?? 0} / {job.progress?.total ?? 0}
      </Text>
    </Flex>
  );
}

/**
 * A completed job's saved count plus the backfilled range — the timestamps of
 * the first and last candles actually retrieved (`summary.from`/`to`), rendered
 * as machine-readable `<time>` elements.
 */
function SuccessSummary({ job }: { job: BackfillJob }): ReactNode {
  const { summary } = job;
  return (
    <Flex direction="column" align="end" gap="0">
      <Text size="2" color="green">
        Saved {summary?.saved ?? 0} candles
      </Text>
      {summary && summary.from !== null && summary.to !== null ? (
        <Text size="1" color="gray">
          <time dateTime={new Date(summary.from).toISOString()}>
            {formatTimestamp(summary.from)}
          </time>
          {' – '}
          <time dateTime={new Date(summary.to).toISOString()}>{formatTimestamp(summary.to)}</time>
        </Text>
      ) : null}
    </Flex>
  );
}

/** An error message paired with a Retry button. */
function RetryableError({ message, onRetry }: { message: string; onRetry: () => void }): ReactNode {
  return (
    <Flex align="center" justify="end" gap="3">
      <Text size="1" color="red" role="alert">
        {message}
      </Text>
      <Button size="1" variant="soft" onClick={onRetry}>
        Retry
      </Button>
    </Flex>
  );
}
