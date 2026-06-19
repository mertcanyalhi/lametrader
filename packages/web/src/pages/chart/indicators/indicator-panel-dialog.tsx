import type { IndicatorDefinition, IndicatorInstance, Profile, SymbolType } from '@lametrader/core';
import {
  AlertDialog,
  Box,
  Button,
  Callout,
  Dialog,
  Flex,
  IconButton,
  ScrollArea,
  Text,
  TextField,
} from '@radix-ui/themes';
import { LineChart, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { SymbolTypeBadge } from '../../../components/symbol-type-badge.js';
import { ApiError } from '../../../lib/api-fetch.js';
import {
  useAttachIndicator,
  useDetachIndicator,
  useIndicatorCatalog,
  useUpdateIndicator,
} from '../../../lib/hooks/indicators.js';
import { useProfiles } from '../../../lib/hooks/profiles.js';
import { getLogger } from '../../../lib/log.js';
import { useSelectedProfile } from '../../../lib/selected-profile-context.js';
import { IndicatorInputsForm } from './indicator-inputs-form.js';

/** Scoped logger for panel lifecycle / mutation failures. */
const log = getLogger('indicator-panel');

/** Props for the indicator-panel trigger + dialog. */
export interface IndicatorPanelDialogProps {
  /** The currently charted symbol's asset class — drives the n/a-row check. */
  symbolType: SymbolType;
}

/**
 * The view currently rendered inside the panel dialog. `list` is the
 * default; `add` opens the catalog → inputs nested dialog; `edit` opens
 * the inputs form pre-filled with the existing instance's inputs.
 */
type View =
  | { kind: 'list' }
  | { kind: 'add' }
  | { kind: 'edit'; instance: IndicatorInstance; definition: IndicatorDefinition };

/**
 * The chart's bottom-bar indicator panel — a trigger button labeled with the
 * selected profile's attached-instance count, opening a dialog that lists each
 * instance and lets the user add / edit / detach. When no profile is selected,
 * the dialog renders a warning callout pointing to the profile picker.
 */
export function IndicatorPanelDialog({ symbolType }: IndicatorPanelDialogProps): ReactNode {
  const { profileId } = useSelectedProfile();
  const profilesQuery = useProfiles();
  const catalogQuery = useIndicatorCatalog();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [toDetach, setToDetach] = useState<IndicatorInstance | null>(null);

  const profile = useMemo(
    () => profilesQuery.data?.find((candidate) => candidate.id === profileId) ?? null,
    [profilesQuery.data, profileId],
  );
  const instances = profile?.indicators ?? [];
  const catalog = catalogQuery.data ?? [];

  const triggerLabel = profile ? `Indicators (${instances.length})` : 'Indicators';

  function handleOpenChange(next: boolean): void {
    setOpen(next);
    if (!next) setView({ kind: 'list' });
  }

  return (
    <>
      <Dialog.Root open={open} onOpenChange={handleOpenChange}>
        <Dialog.Trigger>
          <Button variant="soft" color="gray">
            <LineChart size={14} aria-hidden="true" />
            {triggerLabel}
          </Button>
        </Dialog.Trigger>
        <Dialog.Content maxWidth="520px">
          {profile === null ? (
            <NoProfileView />
          ) : view.kind === 'list' ? (
            <InstanceListView
              instances={instances}
              catalog={catalog}
              symbolType={symbolType}
              onAdd={() => setView({ kind: 'add' })}
              onEdit={(instance, definition) => setView({ kind: 'edit', instance, definition })}
              onDetach={(instance) => setToDetach(instance)}
            />
          ) : view.kind === 'add' ? (
            <AddView
              profile={profile}
              catalog={catalog}
              onCancel={() => setView({ kind: 'list' })}
              onAttached={() => setView({ kind: 'list' })}
            />
          ) : (
            <EditView
              profile={profile}
              instance={view.instance}
              definition={view.definition}
              onCancel={() => setView({ kind: 'list' })}
              onSaved={() => setView({ kind: 'list' })}
            />
          )}
        </Dialog.Content>
      </Dialog.Root>
      {profile !== null && toDetach !== null ? (
        <DetachIndicatorDialog
          profile={profile}
          instance={toDetach}
          definitionName={
            catalog.find((definition) => definition.key === toDetach.indicatorKey)?.name ??
            toDetach.indicatorKey
          }
          onOpenChange={(next) => {
            if (!next) setToDetach(null);
          }}
          onDetached={() => setToDetach(null)}
        />
      ) : null}
    </>
  );
}

/**
 * What the dialog shows when no profile is selected — a warning callout that
 * points back to the profile picker (deliberately no "Add indicator" button,
 * since there is nothing to attach to).
 */
function NoProfileView(): ReactNode {
  return (
    <>
      <Dialog.Title>Indicators</Dialog.Title>
      <Callout.Root color="amber" mt="3">
        <Callout.Icon>
          <TriangleAlert size={16} aria-hidden="true" />
        </Callout.Icon>
        <Callout.Text>Select or create a profile to add indicators.</Callout.Text>
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

/**
 * The default panel view for a selected profile: a header, the "Add indicator"
 * button, then one row per attached instance. Rows for instances whose
 * definition's `appliesTo` excludes the current chart's `SymbolType` render
 * muted with an n/a note (the instance is still attached; it just doesn't
 * compute on this symbol).
 */
function InstanceListView({
  instances,
  catalog,
  symbolType,
  onAdd,
  onEdit,
  onDetach,
}: {
  instances: IndicatorInstance[];
  catalog: IndicatorDefinition[];
  symbolType: SymbolType;
  onAdd: () => void;
  onEdit: (instance: IndicatorInstance, definition: IndicatorDefinition) => void;
  onDetach: (instance: IndicatorInstance) => void;
}): ReactNode {
  return (
    <>
      <Dialog.Title>Indicators</Dialog.Title>
      <Flex direction="column" gap="2" mt="4">
        <Box>
          <Button variant="soft" color="gray" onClick={onAdd}>
            <Plus size={14} aria-hidden="true" />
            Add indicator
          </Button>
        </Box>
        <ScrollArea type="auto" scrollbars="vertical" style={{ maxHeight: '22rem' }}>
          <Flex direction="column" gap="1">
            {instances.map((instance) => {
              const definition = catalog.find(
                (candidate) => candidate.key === instance.indicatorKey,
              );
              const applicable = definition ? definition.appliesTo.includes(symbolType) : true;
              return (
                <InstanceRow
                  key={instance.id}
                  instance={instance}
                  definition={definition ?? null}
                  applicable={applicable}
                  symbolType={symbolType}
                  onEdit={onEdit}
                  onDetach={onDetach}
                />
              );
            })}
          </Flex>
        </ScrollArea>
      </Flex>
    </>
  );
}

/**
 * One instance row — the instance's display name (label or indicator name)
 * plus an edit and a detach icon button. Rows whose definition doesn't apply
 * to the chart's symbol type render muted with an "n/a for <type>" note.
 *
 * Edit is disabled when the definition isn't available (catalog hasn't loaded
 * or the indicator key is unknown locally) — the descriptor-driven form needs
 * the definition to render.
 */
function InstanceRow({
  instance,
  definition,
  applicable,
  symbolType,
  onEdit,
  onDetach,
}: {
  instance: IndicatorInstance;
  definition: IndicatorDefinition | null;
  applicable: boolean;
  symbolType: SymbolType;
  onEdit: (instance: IndicatorInstance, definition: IndicatorDefinition) => void;
  onDetach: (instance: IndicatorInstance) => void;
}): ReactNode {
  const displayName = instance.label ?? definition?.name ?? instance.indicatorKey;
  return (
    <Flex
      align="center"
      gap="2"
      className={`rounded-md border border-[var(--gray-a6)] px-3 py-2 hover:bg-[var(--gray-a3)] ${applicable ? '' : 'opacity-60'}`}
    >
      <Flex direction="column" className="flex-1 min-w-0">
        <Flex gap="2" align="baseline" wrap="wrap">
          <Text size="2">{displayName}</Text>
          {instance.summary ? (
            <Text size="1" color="gray" className="font-mono">
              {instance.summary}
            </Text>
          ) : null}
        </Flex>
        {!applicable ? (
          <Text size="1" color="gray">
            n/a for {symbolType}
          </Text>
        ) : null}
      </Flex>
      <IconButton
        type="button"
        variant="ghost"
        color="gray"
        aria-label={`Edit ${displayName}`}
        disabled={definition === null}
        onClick={() => {
          if (definition) onEdit(instance, definition);
        }}
      >
        <Pencil size={14} aria-hidden="true" />
      </IconButton>
      <IconButton
        type="button"
        variant="ghost"
        color="gray"
        aria-label={`Detach ${displayName}`}
        onClick={() => onDetach(instance)}
      >
        <Trash2 size={14} aria-hidden="true" />
      </IconButton>
    </Flex>
  );
}

/**
 * The "Add indicator" two-step view: pick a catalog entry, then fill its
 * descriptor-driven inputs form. The catalog list is a simple contains-match
 * search over `name` + `description` (two entries today; nothing fancier needed).
 */
function AddView({
  profile,
  catalog,
  onCancel,
  onAttached,
}: {
  profile: Profile;
  catalog: IndicatorDefinition[];
  onCancel: () => void;
  onAttached: () => void;
}): ReactNode {
  const [pick, setPick] = useState<IndicatorDefinition | null>(null);
  const [query, setQuery] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const attach = useAttachIndicator(profile.id);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return catalog;
    return catalog.filter(
      (definition) =>
        definition.name.toLowerCase().includes(needle) ||
        definition.description.toLowerCase().includes(needle),
    );
  }, [catalog, query]);

  async function handleSubmit({ inputs }: { inputs: Record<string, unknown> }): Promise<void> {
    if (!pick) return;
    setErrorMessage(null);
    try {
      const created = await attach.mutateAsync({ indicatorKey: pick.key, inputs });
      toast.success(`Attached ${pick.name}`);
      log.info({ instanceId: created.id, indicatorKey: pick.key }, 'attached indicator');
      onAttached();
    } catch (cause) {
      log.warn({ err: cause, indicatorKey: pick.key }, 'attach indicator failed');
      if (cause instanceof ApiError && cause.status === 400) {
        setErrorMessage(cause.message);
        return;
      }
      const message = cause instanceof ApiError ? cause.message : 'failed to attach indicator';
      toast.error(message);
    }
  }

  if (!pick) {
    return (
      <>
        <Dialog.Title>Add indicator</Dialog.Title>
        <Dialog.Description size="2" color="gray">
          Pick an indicator to attach to “{profile.name}”.
        </Dialog.Description>
        <Flex direction="column" gap="3" mt="3">
          <TextField.Root
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search indicators…"
            aria-label="Search indicators"
          />
          <ScrollArea type="auto" scrollbars="vertical" style={{ maxHeight: '22rem' }}>
            <Flex direction="column" gap="1">
              {filtered.map((definition) => (
                <button
                  key={definition.key}
                  type="button"
                  onClick={() => setPick(definition)}
                  aria-label={definition.name}
                  className="flex flex-col gap-1 rounded-md border border-[var(--gray-a6)] px-3 py-2 text-left hover:bg-[var(--gray-a3)]"
                >
                  <Flex gap="2" align="center" wrap="wrap">
                    <Text size="2" weight="medium">
                      {definition.name}
                    </Text>
                    {definition.appliesTo.map((symbolType) => (
                      <SymbolTypeBadge key={symbolType} type={symbolType} />
                    ))}
                  </Flex>
                  <Text size="1" color="gray">
                    {definition.description}
                  </Text>
                </button>
              ))}
            </Flex>
          </ScrollArea>
        </Flex>
        <Flex gap="3" mt="4" justify="end">
          <Button type="button" variant="soft" color="gray" onClick={onCancel}>
            Cancel
          </Button>
        </Flex>
      </>
    );
  }

  return (
    <>
      <Dialog.Title>Configure {pick.name}</Dialog.Title>
      <Dialog.Description size="2" color="gray">
        {pick.description}
      </Dialog.Description>
      <Box mt="3">
        <IndicatorInputsForm
          inputs={pick.inputs}
          state={pick.state}
          initialValues={{}}
          onSubmit={handleSubmit}
          onCancel={() => setPick(null)}
          errorMessage={errorMessage}
          submitLabel="Save"
          submitting={attach.isPending}
        />
      </Box>
    </>
  );
}

/**
 * The edit view: a single-step descriptor-driven form pre-filled with the
 * instance's `inputs`. On submit, PUTs the (full) instance back — same body
 * as attach.
 */
function EditView({
  profile,
  instance,
  definition,
  onCancel,
  onSaved,
}: {
  profile: Profile;
  instance: IndicatorInstance;
  definition: IndicatorDefinition;
  onCancel: () => void;
  onSaved: () => void;
}): ReactNode {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const update = useUpdateIndicator(profile.id);

  async function handleSubmit({ inputs }: { inputs: Record<string, unknown> }): Promise<void> {
    setErrorMessage(null);
    try {
      await update.mutateAsync({
        instanceId: instance.id,
        indicatorKey: instance.indicatorKey,
        inputs,
        label: instance.label,
      });
      toast.success(`Saved ${definition.name}`);
      onSaved();
    } catch (cause) {
      log.warn({ err: cause, instanceId: instance.id }, 'update indicator failed');
      if (cause instanceof ApiError && cause.status === 400) {
        setErrorMessage(cause.message);
        return;
      }
      const message = cause instanceof ApiError ? cause.message : 'failed to save indicator';
      toast.error(message);
    }
  }

  return (
    <>
      <Dialog.Title>Edit {definition.name}</Dialog.Title>
      <Dialog.Description size="2" color="gray">
        {definition.description}
      </Dialog.Description>
      <Box mt="3">
        <IndicatorInputsForm
          inputs={definition.inputs}
          state={definition.state}
          initialValues={instance.inputs}
          onSubmit={handleSubmit}
          onCancel={onCancel}
          errorMessage={errorMessage}
          submitLabel="Save"
          submitting={update.isPending}
        />
      </Box>
    </>
  );
}

/**
 * Detach confirmation `AlertDialog`. Controlled by the parent — the parent
 * owns the `instance` being detached and decides what to do after the
 * DELETE returns (currently just closes the alert; the row disappears via
 * the profiles-query invalidation).
 */
function DetachIndicatorDialog({
  profile,
  instance,
  definitionName,
  onOpenChange,
  onDetached,
}: {
  profile: Profile;
  instance: IndicatorInstance;
  definitionName: string;
  onOpenChange: (open: boolean) => void;
  onDetached: () => void;
}): ReactNode {
  const detach = useDetachIndicator(profile.id);

  async function handleConfirm(): Promise<void> {
    try {
      await detach.mutateAsync(instance.id);
      toast.success(`Detached ${definitionName}`);
      onDetached();
      onOpenChange(false);
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : 'failed to detach indicator';
      log.warn({ err: cause, instanceId: instance.id }, 'detach indicator failed');
      toast.error(message);
    }
  }

  return (
    <AlertDialog.Root open={true} onOpenChange={onOpenChange}>
      <AlertDialog.Content maxWidth="420px">
        <AlertDialog.Title>Detach indicator</AlertDialog.Title>
        <AlertDialog.Description size="2">
          <Text>
            Detach “{definitionName}” from “{profile.name}”?
          </Text>
        </AlertDialog.Description>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray">
              Cancel
            </Button>
          </AlertDialog.Cancel>
          {/* NOT wrapped in `AlertDialog.Action`: Action's default `onSelect`
              dispatches a click that bubbles through Radix's portal stack and
              also closes the *parent* Dialog (the panel itself).
              Instead, drive the close ourselves from `handleConfirm` so only
              this AlertDialog dismisses — the panel stays open. */}
          <Button color="red" onClick={handleConfirm} loading={detach.isPending}>
            Detach
          </Button>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
