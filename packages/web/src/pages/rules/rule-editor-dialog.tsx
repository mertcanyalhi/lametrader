import { yupResolver } from '@hookform/resolvers/yup';
import {
  type Action,
  type ConditionNode,
  ConditionNodeKind,
  type Expiration,
  type Period,
  type Rule,
  RuleScopeKind,
  type Trigger,
  TriggerKind,
} from '@lametrader/core';
import {
  AlertDialog,
  Box,
  Button,
  Callout,
  Dialog,
  Flex,
  IconButton,
  Select,
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
import { ApiError } from '../../lib/api-fetch.js';
import { useProfiles } from '../../lib/hooks/profiles.js';
import {
  type RuleInput,
  useCreateRule,
  useDeleteRule,
  useReplaceRule,
} from '../../lib/hooks/rules.js';
import { useWatchlist } from '../../lib/hooks/symbols.js';
import {
  DEFAULT_TRIGGER_INTERVAL_MS,
  ExpirationKind,
  FIELD_LABELS,
  isConditionTreeNonEmpty,
  type RuleFormValues,
  ruleFormSchema,
} from '../../lib/rule-form-schema.js';
import { ActionsEditor } from './actions-editor.js';
import { ConditionTreeEditor } from './condition-tree-editor.js';
import { ExpirationPicker } from './expiration-picker.js';
import { TriggerPicker } from './trigger-picker.js';

/**
 * The reusable rule-editor `Dialog`. Owns the modal frame, the create/edit
 * mode toggle, the save/cancel wiring, and the basic-fields form
 * (`name`/`description`/`scope`/`enabled`) — validated via Yup per
 * `packages/web/CLAUDE.md`.
 *
 * The condition tree, trigger, expiration, and actions surfaces land in
 * #169–#175 and will extend this form's shape.
 *
 * @param open         - Controlled open state.
 * @param onOpenChange - Controlled-open callback; closes on Cancel / save success.
 * @param mode         - `'create'` or `'edit'`; drives title + which hook fires.
 * @param initial      - The rule to seed the form with in edit mode (required) or
 *                       a draft to pre-populate a create form (optional).
 */
export function RuleEditorDialog({
  open,
  onOpenChange,
  mode,
  initial,
  lockSymbol = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  initial?: Rule;
  /** Hide the scope + symbol rows; the rule stays bound to `initial`'s symbol (chart create). */
  lockSymbol?: boolean;
}): ReactNode {
  const create = useCreateRule();
  const replace = useReplaceRule();
  const profilesQuery = useProfiles();
  const profile = profilesQuery.data?.find((candidate) => candidate.id === initial?.profileId);
  const indicators = profile?.indicators ?? [];
  const [inlineError, setInlineError] = useState<string | null>(null);
  const submitting = create.isPending || replace.isPending;
  const { register, handleSubmit, setValue, watch, formState } = useForm<RuleFormValues>({
    resolver: yupResolver(ruleFormSchema),
    defaultValues: defaultValuesFor(initial),
    mode: 'onSubmit',
  });
  const scopeKind = watch('scopeKind');
  const symbolId = watch('symbolId');
  const enabled = watch('enabled');
  const condition = watch('condition');
  const triggerKind = watch('triggerKind');
  const triggerPeriod = watch('triggerPeriod');
  const triggerIntervalMs = watch('triggerIntervalMs');
  const expirationKind = watch('expirationKind');
  const expirationAt = watch('expirationAt');
  const actions = watch('actions');
  const nameError = formState.errors.name?.message;
  const symbolError = formState.errors.symbolId?.message;
  const triggerPeriodError = formState.errors.triggerPeriod?.message;
  const expirationError = formState.errors.expirationAt?.message;
  const actionsError = formState.errors.actions?.message;

  const onSubmit: SubmitHandler<RuleFormValues> = async (values) => {
    setInlineError(null);
    if (!isConditionTreeNonEmpty(values.condition)) {
      setInlineError('Every AND / OR group must have at least one child.');
      return;
    }
    try {
      if (mode === 'edit') {
        if (!initial) return;
        await replace.mutateAsync({ id: initial.id, input: mergeInput(initial, values) });
      } else {
        if (!initial) return;
        await create.mutateAsync(mergeInput(initial, values));
      }
      onOpenChange(false);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 400) {
        setInlineError(cause.message);
        return;
      }
      onOpenChange(false);
    }
  };

  const title = mode === 'create' ? 'New rule' : `Edit ${initial?.name ?? 'rule'}`;
  const submitLabel = mode === 'create' ? 'Create' : 'Save';
  const nameErrorId = nameError ? 'rule-name-error' : undefined;
  const symbolErrorId = symbolError ? 'rule-symbol-error' : undefined;
  const profileId = initial?.profileId;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="560px" onInteractOutside={(event) => event.preventDefault()}>
        <Dialog.Title>{title}</Dialog.Title>
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <Flex direction="column" gap="3" mt="3">
            <FieldRow label={FIELD_LABELS.name} htmlFor="rule-name">
              <TextField.Root
                id="rule-name"
                aria-label={FIELD_LABELS.name}
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameErrorId}
                autoFocus
                {...register('name')}
              />
              {nameError ? (
                <Text id={nameErrorId} role="alert" color="red" size="1">
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
            {lockSymbol ? null : (
              <FieldRow label={FIELD_LABELS.scope}>
                <Select.Root
                  value={scopeKind}
                  onValueChange={(value) =>
                    setValue('scopeKind', value as RuleScopeKind, {
                      shouldDirty: true,
                      shouldValidate: false,
                    })
                  }
                >
                  <Select.Trigger aria-label={FIELD_LABELS.scope} className="w-full" />
                  <Select.Content>
                    <Select.Item value={RuleScopeKind.Symbol}>One symbol</Select.Item>
                    <Select.Item value={RuleScopeKind.AllSymbols}>All symbols</Select.Item>
                  </Select.Content>
                </Select.Root>
              </FieldRow>
            )}
            {!lockSymbol && scopeKind === RuleScopeKind.Symbol ? (
              <FieldRow label={FIELD_LABELS.symbolId}>
                <SymbolPicker
                  profileId={profileId}
                  value={symbolId}
                  onChange={(value) =>
                    setValue('symbolId', value, { shouldDirty: true, shouldValidate: false })
                  }
                  invalid={symbolError !== undefined}
                  describedBy={symbolErrorId}
                />
                {symbolError ? (
                  <Text id={symbolErrorId} role="alert" color="red" size="1">
                    {symbolError}
                  </Text>
                ) : null}
              </FieldRow>
            ) : null}
            <Separator size="4" my="1" />

            <FieldRow label={FIELD_LABELS.condition} align="start">
              <ConditionTreeEditor
                value={condition}
                onChange={(next) =>
                  setValue('condition', next, { shouldDirty: true, shouldValidate: false })
                }
                indicators={indicators}
              />
            </FieldRow>

            <Separator size="4" my="1" />

            <FieldRow label={FIELD_LABELS.trigger} align="start">
              <TriggerPicker
                kind={triggerKind}
                onKindChange={(next) =>
                  setValue('triggerKind', next, { shouldDirty: true, shouldValidate: false })
                }
                period={triggerPeriod}
                onPeriodChange={(next) =>
                  setValue('triggerPeriod', next, { shouldDirty: true, shouldValidate: false })
                }
                intervalMs={triggerIntervalMs}
                onIntervalMsChange={(next) =>
                  setValue('triggerIntervalMs', next, {
                    shouldDirty: true,
                    shouldValidate: false,
                  })
                }
                periodError={triggerPeriodError}
              />
            </FieldRow>
            <FieldRow label={FIELD_LABELS.expiration} align="start">
              <ExpirationPicker
                kind={expirationKind}
                onKindChange={(next) =>
                  setValue('expirationKind', next, { shouldDirty: true, shouldValidate: false })
                }
                value={expirationAt}
                onValueChange={(next) =>
                  setValue('expirationAt', next, { shouldDirty: true, shouldValidate: false })
                }
                error={expirationError}
              />
            </FieldRow>
            <Separator size="4" my="1" />

            <FieldRow label={FIELD_LABELS.actions} align="start">
              <ActionsEditor
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
            {mode === 'edit' && initial ? (
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
              <Button type="submit" loading={submitting} disabled={submitting || !initial}>
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
 * A label-left / control-right form row — the muted label sits in a fixed
 * column on the left, the control fills the rest (TradingView-style alert
 * editor). Pass `align="start"` for tall controls (textarea, condition tree,
 * actions list) so the label tracks the first line.
 */
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

/**
 * The destructive footer action — a trash `IconButton` that opens an
 * `AlertDialog` confirmation before deleting the rule. On confirm it fires the
 * optimistic delete and closes the editor via `onDeleted`.
 */
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
            <Button color="red" onClick={() => del.mutate(id, { onSuccess: onDeleted })}>
              Delete
            </Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}

/**
 * The symbol picker for the rule's `scope.symbolId` — a Radix `<Select>`
 * scoped to the watched symbols of the current profile.
 *
 * Lazy: the only profile scope today is `ProfileScope.All`, so every watched
 * symbol qualifies. When per-profile scope filters land, narrow `symbols` to
 * the ones the profile's scope actually covers.
 */
function SymbolPicker({
  profileId: _profileId,
  value,
  onChange,
  invalid,
  describedBy,
}: {
  profileId: string | undefined;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
  describedBy: string | undefined;
}): ReactNode {
  const watchlist = useWatchlist();
  const symbols = watchlist.data ?? [];
  return (
    <Select.Root value={value === '' ? undefined : value} onValueChange={onChange}>
      <Select.Trigger
        placeholder="Pick a symbol"
        aria-label={FIELD_LABELS.symbolId}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="w-full"
      />
      <Select.Content>
        {symbols.map((symbol) => (
          <Select.Item key={symbol.id} value={symbol.id}>
            {symbol.id}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}

/**
 * Build the form's default values from an optional initial rule. Falls back
 * to neutral defaults (empty name/description, `Symbol` scope, enabled) when
 * no initial is provided.
 */
function defaultValuesFor(initial: Rule | undefined): RuleFormValues {
  if (!initial) {
    return {
      name: '',
      description: '',
      scopeKind: RuleScopeKind.Symbol,
      symbolId: '',
      enabled: true,
      condition: defaultCondition(),
      triggerKind: TriggerKind.Once,
      triggerPeriod: '',
      triggerIntervalMs: DEFAULT_TRIGGER_INTERVAL_MS,
      expirationKind: ExpirationKind.Never,
      expirationAt: '',
      actions: [],
    };
  }
  return {
    name: initial.name,
    description: initial.description ?? '',
    scopeKind: initial.scope.kind,
    symbolId: initial.scope.kind === RuleScopeKind.Symbol ? initial.scope.symbolId : '',
    enabled: initial.enabled,
    condition: initial.condition,
    triggerKind: initial.trigger.kind,
    triggerPeriod: triggerPeriodOf(initial.trigger),
    triggerIntervalMs: triggerIntervalOf(initial.trigger),
    expirationKind: initial.expiration === null ? ExpirationKind.Never : ExpirationKind.OnDate,
    expirationAt: initial.expiration === null ? '' : epochMsToDateTimeLocal(initial.expiration.at),
    actions: initial.actions as Action[],
  };
}

/** `<input type="datetime-local">` reads/writes `YYYY-MM-DDTHH:mm` (local). */
function epochMsToDateTimeLocal(at: number): string {
  const d = new Date(at);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Extract a `period` from a bar-based trigger, or `''` when N/A. */
function triggerPeriodOf(trigger: Trigger): Period | '' {
  if (trigger.kind === TriggerKind.OncePerBar || trigger.kind === TriggerKind.OncePerBarClose) {
    return trigger.period;
  }
  return '';
}

/** Extract an `intervalMs` from an `OncePerMinute` trigger, or the default. */
function triggerIntervalOf(trigger: Trigger): number {
  if (trigger.kind === TriggerKind.OncePerMinute) return trigger.intervalMs;
  return DEFAULT_TRIGGER_INTERVAL_MS;
}

/** A neutral starter — an empty `And` group ready for the first child. */
function defaultCondition(): ConditionNode {
  return { kind: ConditionNodeKind.And, children: [] };
}

/**
 * Patch the form's basic-field changes onto the initial rule (preserving its
 * condition/trigger/expiration/actions, which the basic-fields form doesn't
 * touch) and strip the persistence-only fields to derive a {@link RuleInput}.
 */
function mergeInput(initial: Rule, values: RuleFormValues): RuleInput {
  const { id, events, history, createdAt, updatedAt, ...rest } = initial;
  return {
    ...rest,
    name: values.name.trim(),
    description: values.description,
    scope:
      values.scopeKind === RuleScopeKind.Symbol
        ? { kind: RuleScopeKind.Symbol, symbolId: values.symbolId }
        : { kind: RuleScopeKind.AllSymbols },
    enabled: values.enabled,
    condition: values.condition,
    trigger: triggerFrom(values),
    expiration: expirationFrom(values),
    actions: values.actions,
  };
}

/** Build an {@link Expiration} from the flat expiration form fields. */
function expirationFrom(values: RuleFormValues): Expiration {
  if (values.expirationKind === ExpirationKind.Never) return null;
  return { at: Date.parse(values.expirationAt) };
}

/** Build a {@link Trigger} from the flat trigger form fields. */
function triggerFrom(values: RuleFormValues): Trigger {
  switch (values.triggerKind) {
    case TriggerKind.Once:
      return { kind: TriggerKind.Once };
    case TriggerKind.OncePerBar:
      return {
        kind: TriggerKind.OncePerBar,
        // Schema-required; `as Period` is safe — the empty string is rejected
        // by Yup so we never reach here without a real period.
        period: values.triggerPeriod as Period,
      };
    case TriggerKind.OncePerBarClose:
      return { kind: TriggerKind.OncePerBarClose, period: values.triggerPeriod as Period };
    case TriggerKind.OncePerMinute:
      return { kind: TriggerKind.OncePerMinute, intervalMs: values.triggerIntervalMs };
  }
}
