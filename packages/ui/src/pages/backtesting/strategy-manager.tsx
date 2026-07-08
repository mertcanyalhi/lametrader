import type { BacktestStrategy } from '@lametrader/core';
import { Button, Flex, IconButton, Select, Text, Tooltip } from '@radix-ui/themes';
import { Pencil, Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useBacktestStrategies } from '../../lib/hooks/backtest-strategies.js';
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
 * strategies plus New / Edit controls that round-trip through the
 * `/backtest-strategies` API and refresh the selector. Deletion lives inside the
 * edit dialog ({@link StrategyEditorDialog}), not as a separate row action.
 *
 * Selection is **controlled or uncontrolled**: when the page passes `selectedId`
 * + `onSelectedIdChange` the run form and the manager share one selection;
 * otherwise the manager keeps its own. Creating a strategy selects it, and
 * deleting the selected one clears the selection so the selector falls back to
 * its placeholder.
 *
 * @param symbolId - The selected symbol whose state-key catalog seeds the signal
 *                     editors in the dialog.
 * @param selectedId - The controlled selected strategy id (omit for uncontrolled).
 * @param onSelectedIdChange - Called when the selection changes (controlled mode).
 * @param disabled - When `true` (a backtest run is active), the New / Edit
 *                     *actions* are hidden; the selector itself stays
 *                     interactive so the trader can still browse strategies.
 */
export function StrategyManager({
  symbolId,
  selectedId: controlledId,
  onSelectedIdChange,
  disabled = false,
}: {
  symbolId: string;
  selectedId?: string | null;
  onSelectedIdChange?: (id: string | null) => void;
  disabled?: boolean;
}): ReactNode {
  const strategiesQuery = useBacktestStrategies();
  const strategies = strategiesQuery.data ?? [];
  const [internalId, setInternalId] = useState<string | null>(null);
  const selectedId = controlledId !== undefined ? controlledId : internalId;
  const setSelectedId = (id: string | null): void => {
    if (onSelectedIdChange) onSelectedIdChange(id);
    else setInternalId(id);
  };
  const [dialog, setDialog] = useState<DialogState>({ open: false });

  const selected = strategies.find((strategy) => strategy.id === selectedId) ?? null;

  return (
    <Flex direction="column" gap="2" aria-label="Strategy manager" role="group">
      <Flex align="center" gap="2">
        <Text size="2" weight="medium">
          Strategy
        </Text>
        {/* A run hides the mutation actions entirely; the selector below stays live. */}
        {!disabled && (
          <Button
            type="button"
            size="1"
            variant="soft"
            onClick={() => setDialog({ open: true, mode: 'create', initial: undefined })}
          >
            <Plus size={14} aria-hidden="true" />
            New
          </Button>
        )}
      </Flex>
      {/* Grid, not flex: the select column is `minmax(0, 1fr)` so it fills the row
          width minus the auto-sized buttons and can shrink below its content — that
          shrink is what lets Radix's built-in ellipsis truncate a long name. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <Select.Root
          value={selectedId ?? undefined}
          onValueChange={setSelectedId}
          disabled={strategies.length === 0}
        >
          <Select.Trigger
            aria-label="Selected strategy"
            placeholder="No strategy selected"
            className="w-full [&>span]:min-w-0"
          />
          <Select.Content>
            {strategies.map((strategy) => (
              <Select.Item key={strategy.id} value={strategy.id}>
                {strategy.name}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>

        {!disabled && selected !== null && (
          <Tooltip content="Edit strategy">
            <IconButton
              type="button"
              variant="soft"
              color="gray"
              aria-label="Edit strategy"
              onClick={() => setDialog({ open: true, mode: 'edit', initial: selected })}
            >
              <Pencil size={16} aria-hidden="true" />
            </IconButton>
          </Tooltip>
        )}
      </div>

      <StrategyEditorDialog
        open={dialog.open}
        onOpenChange={(next) => {
          if (!next) setDialog({ open: false });
        }}
        mode={dialog.open ? dialog.mode : 'create'}
        initial={dialog.open && dialog.mode === 'edit' ? dialog.initial : undefined}
        symbolId={symbolId}
        onSaved={(strategy) => setSelectedId(strategy.id)}
        onDeleted={(id) => {
          if (selectedId === id) setSelectedId(null);
        }}
      />
    </Flex>
  );
}
