import {
  type BacktestSignal,
  type BacktestStrategy,
  type BacktestStrategyExit,
  type BacktestStrategyFields,
  type BacktestThreshold,
  BacktestThresholdKind,
  StateValueType,
} from '@lametrader/core';
import {
  AlertDialog,
  Button,
  Callout,
  Checkbox,
  Dialog,
  Flex,
  Select,
  Text,
  TextArea,
  TextField,
} from '@radix-ui/themes';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { CollapsibleGroup } from '../../components/collapsible-group.js';
import { FieldLabel } from '../../components/field-label.js';
import { ApiError } from '../../lib/api-fetch.js';
import {
  useCreateBacktestStrategy,
  useDeleteBacktestStrategy,
  useUpdateBacktestStrategy,
} from '../../lib/hooks/backtest-strategies.js';
import { useSymbolStateKeys } from '../../lib/hooks/state.js';
import { defaultStateValue, SignalEditor } from './signal-editor.js';

/**
 * The editor's working copy of a strategy — every mechanism carried alongside a
 * boolean toggle, so a user can flip a section off without losing its draft
 * values, and the enabled toggles collapse into the sparse
 * {@link BacktestStrategyExit} only on save.
 */
interface StrategyDraft {
  /** Human-readable, unique name. */
  name: string;
  /** Free-text description. */
  description: string;
  /** Whether the entry signal is enabled (required checked in v1). */
  entrySignalEnabled: boolean;
  /** The entry signal draft. */
  entrySignal: BacktestSignal;
  /** Whether an exit signal mechanism is enabled. */
  exitSignalEnabled: boolean;
  /** The exit signal draft. */
  exitSignal: BacktestSignal;
  /** Whether a profit-target mechanism is enabled. */
  profitEnabled: boolean;
  /** The profit-target threshold draft. */
  profitTarget: BacktestThreshold;
  /** Whether a stop-loss mechanism is enabled. */
  stopEnabled: boolean;
  /** The stop-loss threshold draft. */
  stopLoss: BacktestThreshold;
}

/** A fresh, empty signal draft (number-typed until a key adopts a type). */
function emptySignal(): BacktestSignal {
  return { key: '', value: defaultStateValue(StateValueType.Number) };
}

/** A fresh threshold draft (fixed offset, zero amount). */
function emptyThreshold(): BacktestThreshold {
  return { kind: BacktestThresholdKind.Fixed, amount: 0 };
}

/**
 * Seed a working draft from an existing strategy (edit) or from scratch (create).
 *
 * In create mode the entry signal starts enabled (v1 requires it) with an empty
 * key; every exit mechanism starts off. In edit mode each toggle reflects
 * whether the snapshot set that mechanism, and the disabled ones seed fresh
 * defaults so flipping them on has sensible values.
 */
function draftFrom(initial: BacktestStrategy | undefined): StrategyDraft {
  if (initial === undefined) {
    return {
      name: '',
      description: '',
      entrySignalEnabled: true,
      entrySignal: emptySignal(),
      exitSignalEnabled: false,
      exitSignal: emptySignal(),
      profitEnabled: false,
      profitTarget: emptyThreshold(),
      stopEnabled: false,
      stopLoss: emptyThreshold(),
    };
  }
  return {
    name: initial.name,
    description: initial.description,
    entrySignalEnabled: true,
    entrySignal: initial.entry.signal,
    exitSignalEnabled: initial.exit.signal !== undefined,
    exitSignal: initial.exit.signal ?? emptySignal(),
    profitEnabled: initial.exit.profitTarget !== undefined,
    profitTarget: initial.exit.profitTarget ?? emptyThreshold(),
    stopEnabled: initial.exit.stopLoss !== undefined,
    stopLoss: initial.exit.stopLoss ?? emptyThreshold(),
  };
}

/**
 * Whether a signal counts as defined — enabled with a non-empty key.
 */
function signalDefined(enabled: boolean, signal: BacktestSignal): boolean {
  return enabled && signal.key.trim() !== '';
}

/**
 * Collapse a valid draft into the persisted {@link BacktestStrategyFields}.
 *
 * The exit object stays sparse — only enabled mechanisms are set — matching the
 * domain's "at least one exit mechanism" contract.
 */
function buildFields(draft: StrategyDraft): BacktestStrategyFields {
  const exit: BacktestStrategyExit = {};
  if (signalDefined(draft.exitSignalEnabled, draft.exitSignal)) exit.signal = draft.exitSignal;
  if (draft.profitEnabled) exit.profitTarget = draft.profitTarget;
  if (draft.stopEnabled) exit.stopLoss = draft.stopLoss;
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    entry: { signal: draft.entrySignal },
    exit,
  };
}

/**
 * The strategy create / edit `Dialog`.
 *
 * The dialog frame is always mounted (controlled `open`); its body — and the
 * per-symbol state-key fetch it seeds the signal editors from — mounts only
 * while open, so a closed dialog never fires a `/state-keys` request and each
 * open re-seeds the draft from `initial`.
 *
 * @param open         - Controlled open state.
 * @param onOpenChange - Controlled-open callback (closes on cancel / save).
 * @param mode         - `'create'` or `'edit'`; drives the title and which hook fires.
 * @param initial      - The strategy to seed the form with in edit mode.
 * @param symbolId     - The selected symbol whose state-key catalog seeds the
 *                         signal comboboxes (`''` disables the fetch).
 * @param onSaved      - Invoked with the created / replaced strategy on success.
 */
export function StrategyEditorDialog({
  open,
  onOpenChange,
  mode,
  initial,
  symbolId,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  initial?: BacktestStrategy;
  symbolId: string;
  onSaved?: (strategy: BacktestStrategy) => void;
  onDeleted?: (id: string) => void;
}): ReactNode {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="560px" onInteractOutside={(event) => event.preventDefault()}>
        <Dialog.Title>{mode === 'create' ? 'New strategy' : 'Edit strategy'}</Dialog.Title>
        {open ? (
          <StrategyEditorForm
            mode={mode}
            initial={initial}
            symbolId={symbolId}
            onOpenChange={onOpenChange}
            onSaved={onSaved}
            onDeleted={onDeleted}
          />
        ) : null}
      </Dialog.Content>
    </Dialog.Root>
  );
}

/**
 * The dialog's inner form — mounted only while the dialog is open.
 *
 * Holds the working draft, fetches the symbol's state-key catalog for the signal
 * comboboxes, computes the save-gate, and fires the create / replace mutation.
 */
function StrategyEditorForm({
  mode,
  initial,
  symbolId,
  onOpenChange,
  onSaved,
  onDeleted,
}: {
  mode: 'create' | 'edit';
  initial?: BacktestStrategy;
  symbolId: string;
  onOpenChange: (open: boolean) => void;
  onSaved?: (strategy: BacktestStrategy) => void;
  onDeleted?: (id: string) => void;
}): ReactNode {
  const stateKeysQuery = useSymbolStateKeys(symbolId);
  const knownKeys = stateKeysQuery.data ?? [];
  const stateKeysLoading = symbolId !== '' && stateKeysQuery.isPending;
  const create = useCreateBacktestStrategy();
  const update = useUpdateBacktestStrategy();
  const del = useDeleteBacktestStrategy();
  const [draft, setDraft] = useState<StrategyDraft>(() => draftFrom(initial));
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const entryDefined = signalDefined(draft.entrySignalEnabled, draft.entrySignal);
  const exitDefined =
    signalDefined(draft.exitSignalEnabled, draft.exitSignal) ||
    draft.profitEnabled ||
    draft.stopEnabled;
  const nameDefined = draft.name.trim() !== '';
  const canSave = nameDefined && entryDefined && exitDefined;
  const submitting = create.isPending || update.isPending;

  async function handleSave(): Promise<void> {
    if (!canSave) return;
    setInlineError(null);
    const fields = buildFields(draft);
    try {
      const saved =
        mode === 'create'
          ? await create.mutateAsync(fields)
          : await update.mutateAsync({ id: initial?.id ?? '', fields });
      onSaved?.(saved);
      toast.success(mode === 'create' ? 'Strategy created' : 'Strategy saved');
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setInlineError('A strategy with that name already exists.');
        return;
      }
      setInlineError(error instanceof Error ? error.message : 'Could not save the strategy.');
    }
  }

  async function handleDelete(): Promise<void> {
    if (initial === undefined) return;
    try {
      await del.mutateAsync(initial.id);
      toast.success('Strategy deleted');
      setConfirmDelete(false);
      onDeleted?.(initial.id);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete the strategy.');
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void handleSave();
      }}
    >
      <Flex direction="column" gap="4" mt="2">
        {inlineError !== null ? (
          <Callout.Root color="red" role="alert">
            <Callout.Text>{inlineError}</Callout.Text>
          </Callout.Root>
        ) : null}

        <div>
          <Text
            as="label"
            htmlFor="strategy-name"
            size="2"
            weight="medium"
            mb="1"
            className="block"
          >
            Name
          </Text>
          <TextField.Root
            id="strategy-name"
            aria-label="Strategy name"
            value={draft.name}
            onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
          />
        </div>

        <div>
          <Text
            as="label"
            htmlFor="strategy-description"
            size="2"
            weight="medium"
            mb="1"
            className="block"
          >
            Description
          </Text>
          <TextArea
            id="strategy-description"
            aria-label="Strategy description"
            value={draft.description}
            onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
          />
        </div>

        <CollapsibleGroup title="Entry" defaultOpen>
          <div>
            <ToggleRow
              label="Signal"
              ariaLabel="Entry signal"
              checked={draft.entrySignalEnabled}
              onCheckedChange={(next) =>
                setDraft((prev) => ({ ...prev, entrySignalEnabled: next }))
              }
            />
            {draft.entrySignalEnabled ? (
              <SignalEditor
                value={draft.entrySignal}
                knownKeys={knownKeys}
                ariaPrefix="Entry signal"
                isLoading={stateKeysLoading}
                onChange={(next) => setDraft((prev) => ({ ...prev, entrySignal: next }))}
              />
            ) : null}
          </div>
        </CollapsibleGroup>

        <CollapsibleGroup title="Exit" defaultOpen>
          <div>
            <ToggleRow
              label="Signal"
              ariaLabel="Exit signal"
              checked={draft.exitSignalEnabled}
              onCheckedChange={(next) => setDraft((prev) => ({ ...prev, exitSignalEnabled: next }))}
            />
            {draft.exitSignalEnabled ? (
              <SignalEditor
                value={draft.exitSignal}
                knownKeys={knownKeys}
                ariaPrefix="Exit signal"
                isLoading={stateKeysLoading}
                onChange={(next) => setDraft((prev) => ({ ...prev, exitSignal: next }))}
              />
            ) : null}
          </div>
          <div>
            <ToggleRow
              label="Profit target"
              ariaLabel="Profit target"
              checked={draft.profitEnabled}
              onCheckedChange={(next) => setDraft((prev) => ({ ...prev, profitEnabled: next }))}
            />
            {draft.profitEnabled ? (
              <ThresholdEditor
                value={draft.profitTarget}
                ariaPrefix="Profit target"
                onChange={(next) => setDraft((prev) => ({ ...prev, profitTarget: next }))}
              />
            ) : null}
          </div>
          <div>
            <ToggleRow
              label="Stop loss"
              ariaLabel="Stop loss"
              checked={draft.stopEnabled}
              onCheckedChange={(next) => setDraft((prev) => ({ ...prev, stopEnabled: next }))}
            />
            {draft.stopEnabled ? (
              <ThresholdEditor
                value={draft.stopLoss}
                ariaPrefix="Stop loss"
                onChange={(next) => setDraft((prev) => ({ ...prev, stopLoss: next }))}
              />
            ) : null}
          </div>
        </CollapsibleGroup>

        {!canSave ? (
          <Text size="1" color="gray">
            A strategy needs an entry signal and at least one exit mechanism.
          </Text>
        ) : null}

        <Flex gap="3" justify={mode === 'edit' ? 'between' : 'end'} align="center">
          {mode === 'edit' ? (
            <AlertDialog.Root open={confirmDelete} onOpenChange={setConfirmDelete}>
              <AlertDialog.Trigger>
                <Button type="button" variant="soft" color="red">
                  Delete
                </Button>
              </AlertDialog.Trigger>
              <AlertDialog.Content maxWidth="420px">
                <AlertDialog.Title>Delete strategy</AlertDialog.Title>
                <AlertDialog.Description size="2">
                  Delete “{initial?.name}”? Saved backtests keep their own snapshot and are
                  unaffected.
                </AlertDialog.Description>
                <Flex gap="3" mt="4" justify="end">
                  <AlertDialog.Cancel>
                    <Button variant="soft" color="gray">
                      Cancel
                    </Button>
                  </AlertDialog.Cancel>
                  <Button color="red" loading={del.isPending} onClick={() => void handleDelete()}>
                    Delete
                  </Button>
                </Flex>
              </AlertDialog.Content>
            </AlertDialog.Root>
          ) : null}
          <Flex gap="3">
            <Button type="button" variant="soft" color="gray" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave || submitting} loading={submitting}>
              Save
            </Button>
          </Flex>
        </Flex>
      </Flex>
    </form>
  );
}

/**
 * A labeled checkbox row — the section toggle for a signal or threshold
 * mechanism. The visible text and the `aria-label` share the label so tests and
 * assistive tech address the control by its section name.
 */
function ToggleRow({
  label,
  ariaLabel,
  checked,
  onCheckedChange,
}: {
  label: string;
  ariaLabel: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
}): ReactNode {
  return (
    <Text as="label" size="2">
      <Flex gap="2" align="center">
        <Checkbox
          aria-label={ariaLabel}
          checked={checked}
          onCheckedChange={(next) => onCheckedChange(next === true)}
        />
        {label}
      </Flex>
    </Text>
  );
}

/**
 * The kind + amount editor for a profit-target / stop-loss threshold, with an
 * info tooltip on the kind dropdown explaining Fixed vs Percentage.
 */
function ThresholdEditor({
  value,
  ariaPrefix,
  onChange,
}: {
  value: BacktestThreshold;
  ariaPrefix: string;
  onChange: (next: BacktestThreshold) => void;
}): ReactNode {
  return (
    <Flex direction="column" gap="2" mt="2">
      <FieldLabel
        label="Threshold"
        hint={THRESHOLD_KIND_HINT}
        hintLabel={`${ariaPrefix} kind explanation`}
      />
      <Flex gap="2" align="center">
        <Select.Root
          value={value.kind}
          onValueChange={(next) => onChange({ ...value, kind: next as BacktestThresholdKind })}
        >
          <Select.Trigger aria-label={`${ariaPrefix} kind`} />
          <Select.Content>
            <Select.Item value={BacktestThresholdKind.Fixed}>Fixed</Select.Item>
            <Select.Item value={BacktestThresholdKind.Percentage}>Percentage</Select.Item>
          </Select.Content>
        </Select.Root>
        <TextField.Root
          aria-label={`${ariaPrefix} amount`}
          type="number"
          inputMode="decimal"
          step="any"
          value={Number.isFinite(value.amount) ? value.amount : 0}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            onChange({ ...value, amount: Number.isFinite(parsed) ? parsed : 0 });
          }}
        />
      </Flex>
    </Flex>
  );
}

/**
 * The threshold-kind info-popover body: a one-line explanation of each
 * {@link BacktestThresholdKind}, so the user knows how `amount` is interpreted.
 */
const THRESHOLD_KIND_HINT =
  'Fixed — an absolute price offset from the entry price. ' +
  'Percentage — a percent of the entry price (5 = 5%).';
