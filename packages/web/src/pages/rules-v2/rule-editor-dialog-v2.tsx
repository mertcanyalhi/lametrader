import { yupResolver } from '@hookform/resolvers/yup';
import { type IndicatorInstance, type Period, RulesV2 } from '@lametrader/core';
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
import { Trash2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { type SubmitHandler, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { ApiError } from '../../lib/api-fetch.js';
import { useProfiles } from '../../lib/hooks/profiles.js';
import {
  type RuleV2Input,
  useCreateRuleV2,
  useDeleteRuleV2,
  usePatchRuleV2,
} from '../../lib/hooks/rules-v2.js';
import { useGlobalState, useSymbolState } from '../../lib/hooks/state.js';
import { useWatchlist } from '../../lib/hooks/symbols.js';
import {
  FIELD_LABELS_V2,
  type RuleV2FormValues,
  ruleV2FormSchema,
} from '../../lib/rule-v2-form-schema.js';
import { ActionsPickerV2 } from './actions-picker-v2.js';
import { ConditionTreeEditorV2 } from './condition-tree-editor-v2.js';
import type { InstancePeriods, KnownStateKeys } from './leaf-editor-v2.js';
import { ScopePickerV2 } from './scope-picker-v2.js';
import { TriggerPickerV2 } from './trigger-picker-v2.js';

/**
 * The v2 rule editor `Dialog`.
 *
 * Owns the modal frame, the create/edit mode toggle, the save/cancel wiring,
 * and the per-section forms (basic fields, scope, trigger, condition tree,
 * actions). Validated via Yup per `packages/web/CLAUDE.md` (the API re-validates
 * on save via the v2 schema validator).
 *
 * @param open         - Controlled open state.
 * @param onOpenChange - Controlled-open callback; closes on Cancel / save success.
 * @param mode         - `'create'` or `'edit'`; drives title + which hook fires.
 * @param initial      - The rule to seed the form with (required in edit mode;
 *                       a draft pre-populates a create form).
 */
export function RuleEditorDialogV2({
  open,
  onOpenChange,
  mode,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  initial: RulesV2.Rule;
}): ReactNode {
  const create = useCreateRuleV2();
  const patch = usePatchRuleV2();
  const profilesQuery = useProfiles();
  const profile = profilesQuery.data?.find((candidate) => candidate.id === initial.profileId);
  const indicators: IndicatorInstance[] = profile?.indicators ?? [];
  const watchlistQuery = useWatchlist();
  const watchedSymbols = watchlistQuery.data ?? [];

  // Seed state-key dropdowns: pick the firing symbol's state if scope is
  // single-symbol, otherwise the first watched symbol; global state always.
  const seedSymbolId =
    initial.scope.kind === RulesV2.RuleScopeKind.Symbol
      ? initial.scope.symbolId
      : initial.scope.kind === RulesV2.RuleScopeKind.Symbols
        ? (initial.scope.symbolIds[0] ?? '')
        : (watchedSymbols[0]?.id ?? '');
  const symbolStateQuery = useSymbolState(seedSymbolId);
  const globalStateQuery = useGlobalState();
  const knownStateKeys: KnownStateKeys = {
    symbol: Object.keys(symbolStateQuery.data ?? {}),
    global: Object.keys(globalStateQuery.data ?? {}),
  };

  // Lazy: assume each instance is computed at the symbol's first watched
  // period; the v1 IndicatorInstance shape doesn't carry the explicit period,
  // and the v2 indicator-binding contract narrows by `Interval` on the row.
  const instancePeriods: InstancePeriods = computeInstancePeriods(
    indicators,
    watchedSymbols.flatMap((symbol) => symbol.periods),
  );

  const [inlineError, setInlineError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const submitting = create.isPending || patch.isPending;

  const { register, handleSubmit, setValue, watch, formState } = useForm<RuleV2FormValues>({
    resolver: yupResolver(ruleV2FormSchema),
    defaultValues: defaultValuesFor(initial),
    mode: 'onSubmit',
  });

  const scope = watch('scope');
  const trigger = watch('trigger');
  const enabled = watch('enabled');
  const condition = watch('condition');
  const actions = watch('actions');
  const nameError = formState.errors.name?.message ?? fieldErrors.name;
  const scopeError = formState.errors.scope?.message ?? fieldErrors.scope;
  const triggerError = formState.errors.trigger?.message ?? fieldErrors.trigger;
  const conditionError = formState.errors.condition?.message ?? fieldErrors.condition;
  const actionsError = formState.errors.actions?.message ?? fieldErrors.actions;

  const onSubmit: SubmitHandler<RuleV2FormValues> = async (values) => {
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

  const title = mode === 'create' ? 'New rule (v2)' : `Edit ${initial.name || 'rule'} (v2)`;
  const submitLabel = mode === 'create' ? 'Create' : 'Save';

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="640px" onInteractOutside={(event) => event.preventDefault()}>
        <Dialog.Title>{title}</Dialog.Title>
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <Flex direction="column" gap="3" mt="3">
            <FieldRow label={FIELD_LABELS_V2.name} htmlFor="rule-v2-name">
              <TextField.Root
                id="rule-v2-name"
                aria-label={FIELD_LABELS_V2.name}
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
            <FieldRow
              label={FIELD_LABELS_V2.description}
              htmlFor="rule-v2-description"
              align="start"
            >
              <TextArea
                id="rule-v2-description"
                aria-label={FIELD_LABELS_V2.description}
                {...register('description')}
              />
            </FieldRow>
            <Separator size="4" my="1" />
            <FieldRow label={FIELD_LABELS_V2.scope} align="start">
              <ScopePickerV2
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
            <FieldRow label={FIELD_LABELS_V2.trigger} align="start">
              <TriggerPickerV2
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
            <FieldRow label={FIELD_LABELS_V2.condition} align="start">
              <ConditionTreeEditorV2
                value={condition}
                onChange={(next) =>
                  setValue('condition', next, { shouldDirty: true, shouldValidate: false })
                }
                indicators={indicators}
                instancePeriods={instancePeriods}
                knownStateKeys={knownStateKeys}
              />
              {conditionError ? (
                <Text role="alert" color="red" size="1">
                  {conditionError}
                </Text>
              ) : null}
            </FieldRow>
            <Separator size="4" my="1" />
            <FieldRow label={FIELD_LABELS_V2.actions} align="start">
              <ActionsPickerV2
                value={actions}
                onChange={(next) =>
                  setValue('actions', next, { shouldDirty: true, shouldValidate: false })
                }
              />
              {actionsError ? (
                <Text role="alert" color="red" size="1">
                  {actionsError}
                </Text>
              ) : null}
            </FieldRow>
            <Separator size="4" my="1" />
            <FieldRow label={FIELD_LABELS_V2.enabled} htmlFor="rule-v2-enabled">
              <Switch
                id="rule-v2-enabled"
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

/** Label/control row — mirrors the v1 dialog's layout for visual consistency. */
function FieldRow({
  label,
  htmlFor,
  align = 'center',
  children,
}: {
  label: string;
  htmlFor?: string;
  align?: 'center' | 'start';
  children: ReactNode;
}): ReactNode {
  return (
    <Flex gap="4" align={align}>
      <Text
        as="label"
        htmlFor={htmlFor}
        size="2"
        color="gray"
        className={align === 'start' ? 'w-28 shrink-0 pt-[6px]' : 'w-28 shrink-0'}
      >
        {label}
      </Text>
      <Box flexGrow="1" minWidth="0">
        {children}
      </Box>
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
  const del = useDeleteRuleV2();
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
 * Derive the form's default values from a {@link RulesV2.Rule} seed.
 *
 * The condition tree, trigger, scope, actions, and enabled flag come straight
 * through; persistence-only fields (`id`, `createdAt`, `updatedAt`, `order`)
 * are preserved on the merge but not bound to controls.
 */
function defaultValuesFor(initial: RulesV2.Rule): RuleV2FormValues {
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
 * persistence-only fields, and return a {@link RuleV2Input} body the v2 API
 * accepts for both create + patch.
 */
function mergeInput(initial: RulesV2.Rule, values: RuleV2FormValues): RuleV2Input {
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
 * trigger, condition, actions) rather than at every leaf path; the v2 fields
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
 * The v1 `IndicatorInstance` shape doesn't carry the period; we default to the
 * first watched period across all symbols as a sensible heuristic. When the
 * future v2 attach API stamps the period on the instance directly, swap this
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
