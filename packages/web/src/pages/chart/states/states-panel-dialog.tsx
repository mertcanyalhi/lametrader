import { type StateValue, StateValueType, type SymbolType } from '@lametrader/core';
import {
  Badge,
  Button,
  Callout,
  Checkbox,
  Dialog,
  Flex,
  ScrollArea,
  Text,
  TextField,
} from '@radix-ui/themes';
import { Layers, TriangleAlert } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  getStoredStateOverlays,
  setStoredStateOverlays,
} from '../../../lib/chart-state-overlays.js';
import {
  type SymbolStateKey,
  useSymbolState,
  useSymbolStateKeys,
} from '../../../lib/hooks/state.js';
import { useSelectedProfile } from '../../../lib/selected-profile-context.js';

/** Props for the states-panel trigger + dialog. */
export interface StatesPanelDialogProps {
  /**
   * The watched symbol id whose state-keys the picker reads
   * (`GET /symbols/:id/state-keys`).
   */
  symbolId: string;
  /**
   * The chart's symbol type — reserved for future "n/a per asset class"
   * filtering. Currently unused (every key the symbol has touched is listed).
   */
  symbolType: SymbolType;
  /**
   * Notified whenever the persisted selection changes, with the next set of
   * checked keys. Lets the chart layer recompute its overlay list without
   * subscribing to `localStorage` directly.
   */
  onChange?: (next: string[]) => void;
}

/**
 * The chart's bottom-bar State changes panel — mirrors the Indicators button + dialog.
 *
 * Trigger renders with the count of currently overlaid keys; clicking opens a
 * dialog whose body is a search input and a scrollable list of one checkbox per
 * state key returned by `GET /symbols/:id/state-keys`. Toggles persist to
 * `localStorage` under `(profileId, symbolId)` (see `lib/chart-state-overlays.ts`).
 */
export function StatesPanelDialog({
  symbolId,
  symbolType: _symbolType,
  onChange,
}: StatesPanelDialogProps): ReactNode {
  const { profileId } = useSelectedProfile();
  const [open, setOpen] = useState(false);
  // Selection is owned here so the trigger badge and the dialog body share one
  // source of truth — both render off `selected`, and a toggle writes through
  // to `localStorage` via `setStoredStateOverlays`.
  const [selected, setSelected] = useState<string[]>(() =>
    profileId ? getStoredStateOverlays(profileId, symbolId) : [],
  );

  // Re-hydrate the selection when `(profileId, symbolId)` changes — the chart
  // can switch symbol without unmounting the panel, and a profile switch
  // resets the per-profile overlay set.
  useEffect(() => {
    setSelected(profileId ? getStoredStateOverlays(profileId, symbolId) : []);
  }, [profileId, symbolId]);

  const triggerAriaLabel = profileId ? `State changes (${selected.length})` : 'State changes';

  function applySelection(next: string[]): void {
    setSelected(next);
    if (profileId) setStoredStateOverlays(profileId, symbolId, next);
    onChange?.(next);
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger>
        <Button
          variant="soft"
          color="gray"
          className="min-w-32 justify-center"
          aria-label={triggerAriaLabel}
        >
          <Layers size={14} aria-hidden="true" />
          State changes
          {profileId ? (
            <Badge variant="soft" color="gray" radius="full">
              {selected.length}
            </Badge>
          ) : null}
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="520px">
        {profileId === null ? (
          <NoProfileView />
        ) : (
          <PickerView
            symbolId={symbolId}
            profileId={profileId}
            selected={selected}
            onApply={applySelection}
          />
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}

/**
 * What the dialog shows when no profile is selected — a warning callout that
 * points back to the profile picker. Mirrors `IndicatorPanelDialog`'s
 * no-profile branch verbatim so the two panels feel identical.
 */
function NoProfileView(): ReactNode {
  return (
    <>
      <Dialog.Title>State changes</Dialog.Title>
      <Callout.Root color="amber" mt="3">
        <Callout.Icon>
          <TriangleAlert size={16} aria-hidden="true" />
        </Callout.Icon>
        <Callout.Text>Select or create a profile to overlay states.</Callout.Text>
      </Callout.Root>
      <Flex gap="3" mt="4" justify="end">
        <Dialog.Close>
          <Button variant="soft" color="gray">
            Close
          </Button>
        </Dialog.Close>
      </Flex>
    </>
  );
}

/** Render a state key's latest value as a compact single token; `—` if unset. */
function formatStateValue(value: StateValue | undefined): string {
  if (value === undefined) return '—';
  switch (value.type) {
    case StateValueType.Bool:
      return value.value ? 'true' : 'false';
    case StateValueType.Number:
      return String(value.value);
    case StateValueType.String:
      return value.value;
  }
}

/**
 * The picker body — search input + scrollable list of one checkbox per known
 * state key. Filters by case-insensitive substring on the key text; the
 * upstream catalog is server-sorted alphabetical so the rendered list stays
 * stable across re-fetches.
 */
function PickerView({
  symbolId,
  profileId,
  selected,
  onApply,
}: {
  symbolId: string;
  profileId: string;
  selected: string[];
  onApply: (next: string[]) => void;
}): ReactNode {
  const keysQuery = useSymbolStateKeys(symbolId);
  const stateQuery = useSymbolState(profileId, symbolId);
  const [query, setQuery] = useState('');

  const filtered = useMemo<SymbolStateKey[]>(() => {
    const needle = query.trim().toLowerCase();
    const all = keysQuery.data ?? [];
    if (!needle) return all;
    return all.filter((row) => row.key.toLowerCase().includes(needle));
  }, [keysQuery.data, query]);

  function toggle(key: string, next: boolean): void {
    const current = new Set(selected);
    if (next) current.add(key);
    else current.delete(key);
    onApply([...current].sort());
  }

  return (
    <>
      <Dialog.Title>State changes</Dialog.Title>
      <Flex direction="column" gap="3" mt="3">
        <TextField.Root
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search state keys…"
          aria-label="Search state keys"
        />
        <ScrollArea type="auto" scrollbars="vertical" style={{ maxHeight: '22rem' }}>
          <Flex direction="column" gap="1">
            {filtered.length === 0 ? (
              <Text size="2" color="gray">
                {keysQuery.isPending
                  ? 'Loading state keys…'
                  : (keysQuery.data?.length ?? 0) === 0
                    ? 'No state keys recorded for this symbol yet.'
                    : 'No matches.'}
              </Text>
            ) : (
              filtered.map((row) => (
                <Flex
                  key={row.key}
                  align="center"
                  gap="2"
                  className="rounded-md border border-[var(--gray-a6)] px-3 py-2 hover:bg-[var(--gray-a3)]"
                >
                  <Text as="label" size="2" className="flex flex-1 items-center gap-2">
                    <Checkbox
                      checked={selected.includes(row.key)}
                      onCheckedChange={(next) => toggle(row.key, next === true)}
                      aria-label={row.key}
                    />
                    <span>{row.key}</span>
                  </Text>
                  <Text size="1" color="gray" className="font-mono">
                    {formatStateValue(stateQuery.data?.[row.key])}
                  </Text>
                </Flex>
              ))
            )}
          </Flex>
        </ScrollArea>
      </Flex>
      <Flex gap="3" mt="4" justify="end">
        <Dialog.Close>
          <Button variant="soft" color="gray">
            Close
          </Button>
        </Dialog.Close>
      </Flex>
    </>
  );
}
