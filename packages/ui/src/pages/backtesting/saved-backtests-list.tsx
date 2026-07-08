import type { Backtest } from '@lametrader/core';
import {
  AlertDialog,
  Badge,
  Button,
  Dialog,
  Flex,
  IconButton,
  Link,
  Spinner,
  Table,
  Text,
  TextField,
  Tooltip,
} from '@radix-ui/themes';
import { History, Pencil, Trash2 } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { formatChange } from '../../lib/format.js';
import {
  useCompletedBacktests,
  useDeleteBacktest,
  useRenameBacktest,
} from '../../lib/hooks/backtests.js';

/** How many saved runs fill one page of the table before pagination kicks in. */
const PAGE_SIZE = 10;

/** Column the saved-backtests table can be sorted on. */
type SortKey = 'name' | 'created' | 'trades' | 'pnl';

/** Sort direction toggled by clicking a sortable header. */
type SortDir = 'asc' | 'desc';

/** Format a saved run's created time as `YYYY-MM-DD HH:mm` (UTC) — minute precision reads cleanly. */
function formatCreated(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
}

/** Compare two backtests on the given key (ascending); string compare for name, numeric otherwise. */
function compareBacktests(a: Backtest, b: Backtest, key: SortKey): number {
  switch (key) {
    case 'name':
      return a.name.localeCompare(b.name);
    case 'created':
      return a.createdAt - b.createdAt;
    case 'trades':
      return a.summary.tradeCount - b.summary.tradeCount;
    case 'pnl':
      return a.summary.totalPnl - b.summary.totalPnl;
  }
}

/**
 * The right-panel saved-backtests list: every completed backtest by name, each
 * loadable, renameable, and deletable over the `/backtests` routes (spec:
 * *UI — saved backtests*).
 *
 * Clicking a name loads that backtest into the page's finished-run view without
 * starting a run; the pencil opens a rename dialog and the trash a delete
 * confirmation, both round-tripping through the API and refreshing the list.
 *
 * @param onLoad - called with the backtest to reload when its name is clicked.
 */
export function SavedBacktestsList({
  onLoad,
}: {
  onLoad: (backtest: Backtest) => void;
}): ReactNode {
  const query = useCompletedBacktests();
  const backtests = query.data ?? [];
  const rename = useRenameBacktest();
  const del = useDeleteBacktest();
  const [toRename, setToRename] = useState<Backtest | null>(null);
  const [toDelete, setToDelete] = useState<Backtest | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('created');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [pageIndex, setPageIndex] = useState(0);

  const sorted = useMemo(() => {
    const factor = sortDir === 'asc' ? 1 : -1;
    return [...backtests].sort((a, b) => factor * compareBacktests(a, b, sortKey));
  }, [backtests, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.min(pageIndex, pageCount - 1);
  const pageRows = sorted.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  function toggleSort(key: SortKey): void {
    if (key === sortKey) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPageIndex(0);
  }

  async function handleDelete(backtest: Backtest): Promise<void> {
    try {
      await del.mutateAsync(backtest.id);
      toast.success('Backtest deleted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete the backtest.');
    } finally {
      setToDelete(null);
    }
  }

  async function handleRename(backtest: Backtest, name: string): Promise<void> {
    try {
      await rename.mutateAsync({ id: backtest.id, name });
      toast.success('Backtest renamed');
      setToRename(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not rename the backtest.');
    }
  }

  if (backtests.length === 0) {
    return (
      <Text size="2" color="gray">
        No saved backtests yet.
      </Text>
    );
  }

  return (
    <Flex direction="column" gap="2">
      <Table.Root size="1" aria-label="Saved backtests">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeaderCell>
              <SortButton
                label="Name"
                active={sortKey === 'name'}
                dir={sortDir}
                onClick={() => toggleSort('name')}
              />
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>
              <SortButton
                label="Created"
                active={sortKey === 'created'}
                dir={sortDir}
                onClick={() => toggleSort('created')}
              />
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>
              <SortButton
                label="Trades"
                active={sortKey === 'trades'}
                dir={sortDir}
                onClick={() => toggleSort('trades')}
              />
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>
              <SortButton
                label="P/L"
                active={sortKey === 'pnl'}
                dir={sortDir}
                onClick={() => toggleSort('pnl')}
              />
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {pageRows.map((backtest) => (
            <Table.Row key={backtest.id} align="center">
              <Table.Cell>
                {/* A link, not a Button: the ghost Button is `justify-content:
                    center`, so the name reads centered in the cell. Radix `Link
                    asChild` styles a real <button> (keyboard + `role="button"`),
                    left-aligned like the plain-text cells beside it. */}
                <Link asChild highContrast color="gray">
                  <button
                    type="button"
                    className="cursor-pointer text-left"
                    onClick={() => onLoad(backtest)}
                  >
                    {backtest.name}
                  </button>
                </Link>
              </Table.Cell>
              <Table.Cell>
                <Text size="1" color="gray">
                  {formatCreated(backtest.createdAt)}
                </Text>
              </Table.Cell>
              <Table.Cell>{backtest.summary.tradeCount}</Table.Cell>
              <Table.Cell>{formatChange(backtest.summary.totalPnl)}</Table.Cell>
              <Table.Cell>
                <Flex gap="1" align="center" justify="end">
                  <Tooltip content="Rename backtest">
                    <IconButton
                      type="button"
                      variant="soft"
                      color="gray"
                      aria-label={`Rename ${backtest.name}`}
                      onClick={() => setToRename(backtest)}
                    >
                      <Pencil size={16} aria-hidden="true" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip content="Delete backtest">
                    <IconButton
                      type="button"
                      variant="soft"
                      color="red"
                      aria-label={`Delete ${backtest.name}`}
                      onClick={() => setToDelete(backtest)}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </IconButton>
                  </Tooltip>
                </Flex>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>

      {pageCount > 1 ? (
        <Flex justify="between" align="center" gap="3">
          <Text size="1" color="gray">
            Page {page + 1} of {pageCount}
          </Text>
          <Flex gap="2">
            <Button
              size="1"
              variant="soft"
              disabled={page === 0}
              onClick={() => setPageIndex(page - 1)}
            >
              Previous
            </Button>
            <Button
              size="1"
              variant="soft"
              disabled={page >= pageCount - 1}
              onClick={() => setPageIndex(page + 1)}
            >
              Next
            </Button>
          </Flex>
        </Flex>
      ) : null}

      <RenameDialog
        backtest={toRename}
        pending={rename.isPending}
        onCancel={() => setToRename(null)}
        onSubmit={handleRename}
      />

      <AlertDialog.Root
        open={toDelete !== null}
        onOpenChange={(next) => {
          if (!next) setToDelete(null);
        }}
      >
        <AlertDialog.Content maxWidth="420px">
          <AlertDialog.Title>Delete backtest</AlertDialog.Title>
          <AlertDialog.Description size="2">
            Delete “{toDelete?.name}”? This removes the saved result and its recorded events.
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <Button
              color="red"
              loading={del.isPending}
              onClick={() => {
                if (toDelete !== null) void handleDelete(toDelete);
              }}
            >
              Delete
            </Button>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Flex>
  );
}

/**
 * The backtesting bottom-bar "Previous runs" trigger + modal — mirrors the chart
 * page's count-badge dialogs (States / Rules).
 *
 * A soft button labelled with the saved-backtests count opens a modal hosting
 * the {@link SavedBacktestsList}. The count reuses {@link useCompletedBacktests}
 * — the same query the list runs, so TanStack Query dedupes the fetch — and
 * shows a {@link Spinner} while the query is pending so the badge never flashes
 * a misleading `0` (matching the chart badges' loading precedent).
 *
 * @param onLoad - forwarded to the list; also closes the modal so the loaded
 *   backtest takes over the page.
 * @param disabled - disables the trigger while the page is locked (a run active
 *   or a backtest already loaded), matching the sibling pickers.
 */
export function PreviousRunsDialog({
  onLoad,
  disabled = false,
}: {
  onLoad: (backtest: Backtest) => void;
  disabled?: boolean;
}): ReactNode {
  const query = useCompletedBacktests();
  const [open, setOpen] = useState(false);
  const count = query.data?.length ?? 0;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger>
        <Button
          variant="soft"
          color="gray"
          className="min-w-32 justify-center"
          disabled={disabled}
          aria-label={query.isPending ? 'Previous runs (loading)' : `Previous runs (${count})`}
        >
          <History size={14} aria-hidden="true" />
          Previous runs
          <Badge variant="soft" color="gray" radius="full">
            {query.isPending ? <Spinner size="1" /> : count}
          </Badge>
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="640px">
        <Dialog.Title>Previous runs</Dialog.Title>
        <SavedBacktestsList
          onLoad={(backtest) => {
            setOpen(false);
            onLoad(backtest);
          }}
        />
        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray">
              Close
            </Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/**
 * The rename dialog: a single text field seeded with the backtest's current
 * name, its Save disabled until the name is non-empty. Controlled by the parent
 * through the nullable `backtest` (open when non-null).
 */
function RenameDialog({
  backtest,
  pending,
  onCancel,
  onSubmit,
}: {
  backtest: Backtest | null;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (backtest: Backtest, name: string) => void;
}): ReactNode {
  const [name, setName] = useState('');
  const trimmed = name.trim();

  return (
    <Dialog.Root
      open={backtest !== null}
      onOpenChange={(next) => {
        if (next) setName(backtest?.name ?? '');
        else onCancel();
      }}
    >
      <Dialog.Content maxWidth="420px">
        <Dialog.Title>Rename backtest</Dialog.Title>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (backtest !== null && trimmed.length > 0) onSubmit(backtest, trimmed);
          }}
        >
          <Text as="label" htmlFor="backtest-rename-name" size="2" mb="1" weight="medium">
            Name
          </Text>
          <TextField.Root
            id="backtest-rename-name"
            aria-label="Backtest name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Backtest name"
          />
          <Flex gap="3" mt="4" justify="end">
            <Dialog.Close>
              <Button type="button" variant="soft" color="gray">
                Cancel
              </Button>
            </Dialog.Close>
            <Button type="submit" loading={pending} disabled={trimmed.length === 0}>
              Save
            </Button>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/**
 * A sortable column header — a ghost button whose accessible name is the plain
 * column label; the asc/desc caret is decorative (`aria-hidden`) so the name
 * stays queryable by label alone.
 *
 * Lazy: mirrors the identical helper in `results-tabs.tsx`; extract to a shared
 * `lib/` module on the third instance rather than coupling the two files now.
 */
function SortButton({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}): ReactNode {
  return (
    <Button variant="ghost" size="1" color="gray" onClick={onClick}>
      {label}
      <Text aria-hidden="true">{active ? (dir === 'asc' ? '▲' : '▼') : ''}</Text>
    </Button>
  );
}
