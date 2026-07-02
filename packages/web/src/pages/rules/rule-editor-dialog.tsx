import { yupResolver } from '@hookform/resolvers/yup';
import {
  type IndicatorInstance,
  type Period,
  type Rule,
  RuleScopeKind,
  type StateValue,
  StateValueType,
} from '@lametrader/core';
import {
  AlertDialog,
  Box,
  Button,
  Callout,
  Dialog,
  Flex,
  IconButton,
  Separator,
  Switch,
  Text,
  TextArea,
  TextField,
  Tooltip,
} from '@radix-ui/themes';
import { Info, Trash2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { type SubmitHandler, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { ApiError } from '../../lib/api-fetch.js';
import { useIndicatorCatalog } from '../../lib/hooks/indicators.js';
import { useProfiles } from '../../lib/hooks/profiles.js';
import {
  type RuleInput,
  useCreateRule,
  useDeleteRule,
  usePatchRule,
} from '../../lib/hooks/rules.js';
import { useGlobalState, useSymbolStateKeys } from '../../lib/hooks/state.js';
import { useWatchlist } from '../../lib/hooks/symbols.js';
import { FIELD_LABELS, type RuleFormValues, ruleFormSchema } from '../../lib/rule-form-schema.js';
import { ActionsPicker } from './actions-picker.js';
import { ConditionTreeEditor } from './condition-tree-editor.js';
import type { InstancePeriods, KnownStateKeys } from './leaf-editor.js';
import { filterIndicatorsByScope, type IndicatorStateKeysByKey } from './operand-picker.js';
import { ScopePicker } from './scope-picker.js';
import { TRIGGER_KIND_EXPLANATIONS, TRIGGER_KIND_LABELS, TriggerPicker } from './trigger-picker.js';

/**
 * The rule editor `Dialog`.
 *
 * Owns the modal frame, the create/edit mode toggle, the save/cancel wiring,
 * and the per-section forms (basic fields, scope, trigger, condition tree,
 * actions). Validated via Yup per `packages/web/CLAUDE.md` (the API re-validates
 * on save via the domain schema validator).
 *
 * @param open         - Controlled open state.
 * @param onOpenChange - Controlled-open callback; closes on Cancel / save success.
 * @param mode         - `'create'` or `'edit'`; drives title + which hook fires.
 * @param initial      - The rule to seed the form with (required in edit mode;
 *                       a draft pre-populates a create form).
 */
export function RuleEditorDialog({
  open,
  onOpenChange,
  mode,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  initial: Rule;
}): ReactNode {
  const create = useCreateRule();
  const patch = usePatchRule();
  const profilesQuery = useProfiles();
  const profile = profilesQuery.data?.find((candidate) => candidate.id === initial.profileId);
  const indicators: IndicatorInstance[] = profile?.indicators ?? [];
  const watchlistQuery = useWatchlist();
  const watchedSymbols = watchlistQuery.data ?? [];

  // Seed state-key dropdowns: pick the firing symbol's state if scope is
  // single-symbol, otherwise the first watched symbol; global state always.
  //
  // Symbol-state uses the events-log-backed `/state-keys` catalog so a key
  // that's ever been written under the symbol seeds the combobox with its
  // known type, even if currently removed or if it was written by a rule
  // on a different profile (issue #434). The typed-value fetch on `/state`
  // was profile-scoped and empty for the common case (fresh profile, rule
  // scope not narrowing to the write-target symbol), which starved the
  // auto-type path.
  const seedSymbolId =
    initial.scope.kind === RuleScopeKind.Symbol
      ? initial.scope.symbolId
      : initial.scope.kind === RuleScopeKind.Symbols
        ? (initial.scope.symbolIds[0] ?? '')
        : (watchedSymbols[0]?.id ?? '');
  const symbolStateKeysQuery = useSymbolStateKeys(seedSymbolId);
  const globalStateQuery = useGlobalState(initial.profileId);
  const knownStateKeys: KnownStateKeys = {
    symbol: symbolStateEntriesFromKeys(symbolStateKeysQuery.data ?? []),
    global: globalStateQuery.data ?? {},
  };
  const stateKeysLoading = symbolStateKeysQuery.isPending || globalStateQuery.isPending;

  // Seed the `IndicatorRef` operand's state-key combobox from the catalog —
  // one map entry per `IndicatorDefinition.key`, listing its `state[].key`s.
  const indicatorCatalogQuery = useIndicatorCatalog();
  const indicatorStateKeysByKey: IndicatorStateKeysByKey = {};
  const catalog = Array.isArray(indicatorCatalogQuery.data) ? indicatorCatalogQuery.data : [];
  for (const definition of catalog) {
    indicatorStateKeysByKey[definition.key] = definition.state.map((field) => field.key);
  }

  // Lazy: assume each instance is computed at the symbol's first watched
  // period; the IndicatorInstance shape doesn't carry the explicit period,
  // and the indicator-binding contract narrows by `Interval` on the row.
  const instancePeriods: InstancePeriods = computeInstancePeriods(
    indicators,
    watchedSymbols.flatMap((symbol) => symbol.periods),
  );

  const [inlineError, setInlineError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const submitting = create.isPending || patch.isPending;

  const { register, handleSubmit, setValue, watch, formState } = useForm<RuleFormValues>({
    resolver: yupResolver(ruleFormSchema),
    defaultValues: defaultValuesFor(initial),
    mode: 'onSubmit',
  });

  const scope = watch('scope');
  const trigger = watch('trigger');
  const enabled = watch('enabled');
  const condition = watch('condition');
  const actions = watch('actions');
  // Apply scope-aware filtering before the condition tree sees the indicator list —
  // for `Symbols(list)` we restrict to instances common across the selection (per
  // issue #428 item 7). `Symbol` and `AllSymbols` pass through unchanged.
  const scopedIndicators = filterIndicatorsByScope(indicators, scope, profile?.scope);
  const nameError = formState.errors.name?.message ?? fieldErrors.name;
  const scopeError = formState.errors.scope?.message ?? fieldErrors.scope;
  const triggerError = formState.errors.trigger?.message ?? fieldErrors.trigger;
  const conditionError = formState.errors.condition?.message ?? fieldErrors.condition;
  const actionsError = formState.errors.actions?.message ?? fieldErrors.actions;

  const onSubmit: SubmitHandler<RuleFormValues> = async (values) => {
    setInlineError(null);
    setFieldErrors({});
    const input = mergeInput(initial, values);
    try {
      if (mode === 'edit') {
        await patch.mutateAsync({ id: initial.id, patch: input });
      } else {
        await create.mutateAsync(input);
      }
      onOpenChange(false);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 400) {
        setInlineError(cause.message);
        if (cause.fields !== undefined) {
          const next: Record<string, string> = {};
          for (const field of cause.fields) {
            next[topLevelKey(field.path)] = field.message;
          }
          setFieldErrors(next);
        }
        return;
      }
      onOpenChange(false);
    }
  };

  const title = mode === 'create' ? 'New rule' : `Edit ${initial.name || 'rule'}`;
  const submitLabel = mode === 'create' ? 'Create' : 'Save';

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="640px" onInteractOutside={(event) => event.preventDefault()}>
        <Dialog.Title>{title}</Dialog.Title>
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <Flex direction="column" gap="3" mt="3">
            <FieldRow label={FIELD_LABELS.name} htmlFor="rule-name">
              <TextField.Root
                id="rule-name"
                aria-label={FIELD_LABELS.name}
                aria-invalid={nameError ? true : undefined}
                autoFocus
                {...register('name')}
              />
              {nameError ? (
                <Text role="alert" color="red" size="1">
                  {nameError}
                </Text>
              ) : null}
            </FieldRow>
            <FieldRow label={FIELD_LABELS.description} htmlFor="rule-description" align="start">
              <TextArea
                id="rule-description"
                aria-label={FIELD_LABELS.description}
                {...register('description')}
              />
            </FieldRow>
            <Separator size="4" my="1" />
            <FieldRow label={FIELD_LABELS.scope} align="start">
              <ScopePicker
                value={scope}
                watchedSymbols={watchedSymbols}
                onChange={(next) =>
                  setValue('scope', next, { shouldDirty: true, shouldValidate: false })
                }
              />
              {scopeError ? (
                <Text role="alert" color="red" size="1">
                  {scopeError}
                </Text>
              ) : null}
            </FieldRow>
            <Separator size="4" my="1" />
            <FieldRow
              label={FIELD_LABELS.trigger}
              align="start"
              info={<TriggerKindsInfo />}
              infoLabel="Trigger kinds info"
            >
              <TriggerPicker
                value={trigger}
                onChange={(next) =>
                  setValue('trigger', next, { shouldDirty: true, shouldValidate: false })
                }
              />
              {triggerError ? (
                <Text role="alert" color="red" size="1">
                  {triggerError}
                </Text>
              ) : null}
            </FieldRow>
            <Separator size="4" my="1" />
            <FieldRow label={FIELD_LABELS.condition} align="start">
              <ConditionTreeEditor
                value={condition}
                onChange={(next) =>
                  setValue('condition', next, { shouldDirty: true, shouldValidate: false })
                }
                indicators={scopedIndicators}
                instancePeriods={instancePeriods}
                knownStateKeys={knownStateKeys}
                stateKeysLoading={stateKeysLoading}
                indicatorStateKeysByKey={indicatorStateKeysByKey}
                priorActions={actions}
              />
              {conditionError ? (
                <Text role="alert" color="red" size="1">
                  {conditionError}
                </Text>
              ) : null}
            </FieldRow>
            <Separator size="4" my="1" />
            <FieldRow label={FIELD_LABELS.actions} align="start">
              <ActionsPicker
                value={actions}
                onChange={(next) =>
                  setValue('actions', next, { shouldDirty: true, shouldValidate: false })
                }
                knownStateKeys={knownStateKeys}
                stateKeysLoading={stateKeysLoading}
              />
              {actionsError ? (
                <Text role="alert" color="red" size="1">
                  {actionsError}
                </Text>
              ) : null}
            </FieldRow>
            <Separator size="4" my="1" />
            <FieldRow label={FIELD_LABELS.enabled} htmlFor="rule-enabled">
              <Switch
                id="rule-enabled"
                checked={enabled}
                onCheckedChange={(next) =>
                  setValue('enabled', next === true, { shouldDirty: true, shouldValidate: false })
                }
              />
            </FieldRow>
            {inlineError ? (
              <Callout.Root color="red" role="alert">
                <Callout.Text>{inlineError}</Callout.Text>
              </Callout.Root>
            ) : null}
          </Flex>
          <Separator size="4" my="4" />
          <Flex gap="3" align="center">
            {mode === 'edit' ? (
              <DeleteRuleButton
                id={initial.id}
                name={initial.name}
                disabled={submitting}
                onDeleted={() => onOpenChange(false)}
              />
            ) : null}
            <Flex gap="3" justify="end" flexGrow="1">
              <Button
                type="button"
                variant="soft"
                color="gray"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" loading={submitting} disabled={submitting}>
                {submitLabel}
              </Button>
            </Flex>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/**
 * Label/control row — mirrors the v1 dialog's layout for visual consistency.
 *
 * Optional `info` slot renders an `Info` icon next to the label that hovers a
 * Radix `<Tooltip>`; supply a string `infoLabel` so the icon-only target has an
 * accessible name (Radix's tooltip is a *description*, not a *name*).
 */
function FieldRow({
  label,
  htmlFor,
  align = 'center',
  info,
  infoLabel,
  children,
}: {
  label: string;
  htmlFor?: string;
  align?: 'center' | 'start';
  info?: ReactNode;
  infoLabel?: string;
  children: ReactNode;
}): ReactNode {
  return (
    <Flex gap="4" align={align}>
      <Flex
        gap="1"
        align="center"
        className={align === 'start' ? 'w-28 shrink-0 pt-[6px]' : 'w-28 shrink-0'}
      >
        <Text as="label" htmlFor={htmlFor} size="2" color="gray">
          {label}
        </Text>
        {info !== undefined && infoLabel !== undefined ? (
          <Tooltip content={info}>
            <IconButton
              type="button"
              variant="ghost"
              color="gray"
              size="1"
              aria-label={infoLabel}
              className="cursor-help"
            >
              <Info size={14} aria-hidden="true" />
            </IconButton>
          </Tooltip>
        ) : null}
      </Flex>
      <Box flexGrow="1" minWidth="0">
        {children}
      </Box>
    </Flex>
  );
}

/**
 * The trigger label's hover-tooltip content — lists every {@link TriggerKind}
 * with a one-sentence explanation so the user can map the kind to its
 * evaluation cadence without leaving the form.
 */
function TriggerKindsInfo(): ReactNode {
  return (
    <Flex direction="column" gap="1" style={{ maxWidth: '20rem' }}>
      {(Object.keys(TRIGGER_KIND_LABELS) as Array<keyof typeof TRIGGER_KIND_LABELS>).map((kind) => (
        <Text size="1" key={kind}>
          <strong>{TRIGGER_KIND_LABELS[kind]}</strong> — {TRIGGER_KIND_EXPLANATIONS[kind]}
        </Text>
      ))}
    </Flex>
  );
}

/** The destructive footer action — trash IconButton + AlertDialog confirm. */
function DeleteRuleButton({
  id,
  name,
  disabled,
  onDeleted,
}: {
  id: string;
  name: string;
  disabled: boolean;
  onDeleted: () => void;
}): ReactNode {
  const del = useDeleteRule();
  return (
    <AlertDialog.Root>
      <Tooltip content="Delete rule">
        <AlertDialog.Trigger>
          <IconButton
            type="button"
            variant="soft"
            color="red"
            aria-label="Delete rule"
            disabled={disabled}
          >
            <Trash2 size={16} aria-hidden="true" />
          </IconButton>
        </AlertDialog.Trigger>
      </Tooltip>
      <AlertDialog.Content maxWidth="420px">
        <AlertDialog.Title>Delete rule</AlertDialog.Title>
        <AlertDialog.Description size="2">
          Delete “{name}”? This can't be undone.
        </AlertDialog.Description>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray">
              Cancel
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button
              color="red"
              onClick={() =>
                del.mutate(id, {
                  onSuccess: () => {
                    toast.success(`Deleted ${name}`);
                    onDeleted();
                  },
                  onError: (cause) => {
                    const message =
                      cause instanceof ApiError ? cause.message : `Failed to delete ${name}`;
                    toast.error(message);
                  },
                })
              }
            >
              Delete
            </Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}

/**
 * Derive the form's default values from a {@link Rule} seed.
 *
 * The condition tree, trigger, scope, actions, and enabled flag come straight
 * through; persistence-only fields (`id`, `createdAt`, `updatedAt`, `order`)
 * are preserved on the merge but not bound to controls.
 */
function defaultValuesFor(initial: Rule): RuleFormValues {
  return {
    name: initial.name,
    description: initial.description ?? '',
    scope: initial.scope,
    trigger: initial.trigger,
    condition: initial.condition,
    actions: initial.actions,
    enabled: initial.enabled,
  };
}

/**
 * Patch the form's basic-field changes onto the initial rule (preserving
 * `order` + `expiration` which the editor doesn't bind), strip the
 * persistence-only fields, and return a {@link RuleInput} body the API
 * accepts for both create + patch.
 */
function mergeInput(initial: Rule, values: RuleFormValues): RuleInput {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = initial;
  return {
    ...rest,
    name: values.name.trim(),
    description: values.description,
    scope: values.scope,
    trigger: values.trigger,
    condition: values.condition,
    actions: values.actions,
    enabled: values.enabled,
  };
}

/**
 * Map a dotted body path (e.g. `'scope.symbolId'`) to its top-level form key.
 *
 * The editor surfaces field errors by the section they belong to (scope,
 * trigger, condition, actions) rather than at every leaf path; the fields
 * envelope reports the full path, so we collapse to the section root here.
 */
function topLevelKey(path: string): string {
  if (path === '') return 'name';
  const head = path.split('.', 1)[0];
  return head ?? 'name';
}

/**
 * Best-effort lookup of which {@link Period} each indicator instance is
 * computed at — used to filter the row's indicator dropdown by `Interval`.
 *
 * The `IndicatorInstance` shape doesn't carry the period; we default to the
 * first watched period across all symbols as a sensible heuristic. When a
 * future attach API stamps the period on the instance directly, swap this
 * for a direct read.
 */
function computeInstancePeriods(
  indicators: IndicatorInstance[],
  watchedPeriods: Period[],
): InstancePeriods {
  const result: InstancePeriods = {};
  const fallback = watchedPeriods[0];
  for (const instance of indicators) {
    result[instance.id] = fallback;
  }
  return result;
}

/**
 * Turn `useSymbolStateKeys`' `[{ key, valueType }]` catalog into the
 * `Record<string, StateValue>` shape {@link KnownStateKeys} carries. Value
 * is filled with the type's neutral zero — the actions picker only reads
 * `.type` off it, so the value never surfaces.
 */
function symbolStateEntriesFromKeys(
  keys: ReadonlyArray<{ key: string; valueType: StateValueType }>,
): Record<string, StateValue> {
  const result: Record<string, StateValue> = {};
  if (!Array.isArray(keys)) return result;
  for (const { key, valueType } of keys) {
    result[key] = defaultStateValueFor(valueType);
  }
  return result;
}

/** Neutral zero for each {@link StateValueType} — used only for shape padding. */
function defaultStateValueFor(type: StateValueType): StateValue {
  switch (type) {
    case StateValueType.Number:
      return { type, value: 0 };
    case StateValueType.Bool:
      return { type, value: false };
    case StateValueType.String:
      return { type, value: '' };
  }
}
