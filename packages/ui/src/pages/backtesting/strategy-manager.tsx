import type { BacktestStrategy } from '@lametrader/core';
import { AlertDialog, Button, Flex, IconButton, Select, Text, Tooltip } from '@radix-ui/themes';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import {
  useBacktestStrategies,
  useDeleteBacktestStrategy,
} from '../../lib/hooks/backtest-strategies.js';
import { StrategyEditorDialog } from './strategy-editor-dialog.js';

/**
 * The dialog's controlled state — closed, or open in create / edit mode carrying
 * the strategy being edited.
 */
type DialogState =
  | { open: false }
  | { open: true; mode: 'create'; initial: undefined }
  | { open: true; mode: 'edit'; initial: BacktestStrategy };

/**
 * The `/backtesting` right-panel strategy manager: a selector over the saved
 * strategies plus New / Edit / Delete controls that round-trip through the
 * `/backtest-strategies` API and refresh the selector.
 *
 * Selection lives here (the run form in a later slice reads it); creating a
 * strategy selects it, and deleting the selected one clears the selection so the
 * selector falls back to its placeholder.
 *
 * @param symbolId - The selected symbol whose state-key catalog seeds the signal
 *                     editors in the dialog.
 */
export function StrategyManager({ symbolId }: { symbolId: string }): ReactNode {
  const strategiesQuery = useBacktestStrategies();
  const strategies = strategiesQuery.data ?? [];
  const del = useDeleteBacktestStrategy();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>({ open: false });
  const [toDelete, setToDelete] = useState<BacktestStrategy | null>(null);

  const selected = strategies.find((strategy) => strategy.id === selectedId) ?? null;

  async function handleDelete(strategy: BacktestStrategy): Promise<void> {
    try {
      await del.mutateAsync(strategy.id);
      if (selectedId === strategy.id) setSelectedId(null);
      toast.success('Strategy deleted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete the strategy.');
    } finally {
      setToDelete(null);
    }
  }

  return (
    <Flex direction="column" gap="2" aria-label="Strategy manager" role="group">
      <Text size="2" weight="medium">
        Strategy
      </Text>
      <Flex gap="2" align="center">
        <Select.Root
          value={selectedId ?? undefined}
          onValueChange={setSelectedId}
          disabled={strategies.length === 0}
        >
          <Select.Trigger
            aria-label="Selected strategy"
            placeholder="No strategy selected"
            className="grow"
          />
          <Select.Content>
            {strategies.map((strategy) => (
              <Select.Item key={strategy.id} value={strategy.id}>
                {strategy.name}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>

        <Button
          type="button"
          variant="soft"
          onClick={() => setDialog({ open: true, mode: 'create', initial: undefined })}
        >
          <Plus size={16} aria-hidden="true" />
          New
        </Button>

        <Tooltip content="Edit strategy">
          <IconButton
            type="button"
            variant="soft"
            color="gray"
            aria-label="Edit strategy"
            disabled={selected === null}
            onClick={() => {
              if (selected !== null) setDialog({ open: true, mode: 'edit', initial: selected });
            }}
          >
            <Pencil size={16} aria-hidden="true" />
          </IconButton>
        </Tooltip>

        <Tooltip content="Delete strategy">
          <IconButton
            type="button"
            variant="soft"
            color="red"
            aria-label="Delete strategy"
            disabled={selected === null}
            onClick={() => setToDelete(selected)}
          >
            <Trash2 size={16} aria-hidden="true" />
          </IconButton>
        </Tooltip>
      </Flex>

      <StrategyEditorDialog
        open={dialog.open}
        onOpenChange={(next) => {
          if (!next) setDialog({ open: false });
        }}
        mode={dialog.open ? dialog.mode : 'create'}
        initial={dialog.open && dialog.mode === 'edit' ? dialog.initial : undefined}
        symbolId={symbolId}
        onSaved={(strategy) => setSelectedId(strategy.id)}
      />

      <AlertDialog.Root
        open={toDelete !== null}
        onOpenChange={(next) => {
          if (!next) setToDelete(null);
        }}
      >
        <AlertDialog.Content maxWidth="420px">
          <AlertDialog.Title>Delete strategy</AlertDialog.Title>
          <AlertDialog.Description size="2">
            Delete “{toDelete?.name}”? Saved backtests keep their own snapshot and are unaffected.
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
