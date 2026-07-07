import type { Backtest } from '@lametrader/core';
import {
  AlertDialog,
  Badge,
  Button,
  Dialog,
  Flex,
  IconButton,
  Spinner,
  Text,
  TextField,
  Tooltip,
} from '@radix-ui/themes';
import { History, Pencil, Trash2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import {
  useCompletedBacktests,
  useDeleteBacktest,
  useRenameBacktest,
} from '../../lib/hooks/backtests.js';

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
    <Flex direction="column" gap="1" aria-label="Saved backtests" role="list">
      {backtests.map((backtest) => (
        <Flex key={backtest.id} align="center" justify="between" gap="2" role="listitem">
          <Button
            type="button"
            variant="ghost"
            className="grow justify-start"
            onClick={() => onLoad(backtest)}
          >
            {backtest.name}
          </Button>
          <Flex gap="1" align="center">
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
        </Flex>
      ))}

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
