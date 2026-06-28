import { yupResolver } from '@hookform/resolvers/yup';
import { RulesV2 } from '@lametrader/core';
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
import { ApiError, type ApiFieldError } from '../../lib/api-fetch.js';
import { useProfiles } from '../../lib/hooks/profiles.js';
import {
  type RuleV2Input,
  useCreateRuleV2,
  useDeleteRuleV2,
  useReplaceRuleV2,
} from '../../lib/hooks/rules-v2.js';
import { useWatchlist } from '../../lib/hooks/symbols.js';
import {
  ExpirationKindV2,
  expirationV2FromForm,
  FIELD_LABELS_V2,
  isConditionTreeV2NonEmpty,
  type RuleV2FormValues,
  ruleV2FormSchema,
  scopeV2FromForm,
  scopeV2ToForm,
  triggerV2FromForm,
  triggerV2ToForm,
} from '../../lib/rule-v2-form-schema.js';
import { ActionsEditorV2 } from './actions-editor.js';
import { ConditionTreeEditorV2 } from './condition-tree-editor.js';
import { ExpirationPickerV2 } from './expiration-picker-v2.js';
import { ScopePickerV2 } from './scope-picker.js';
import { TriggerPickerV2 } from './trigger-picker.js';

/**
 * The reusable v2 rule-editor `Dialog`. Owns the modal frame, the
 * create/edit toggle, the save/cancel wiring, the v2 form schema, and the
 * field-error mapping from the server's `{ fields[] }` envelope (#395) onto
 * the inner pickers' inline messages.
 */
export function RuleV2EditorDialog({
  open,
  onOpenChange,
  mode,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  /** The rule to seed the form with in edit mode, or a draft for create. */
  initial: RulesV2.Rule;
}): ReactNode {
  const create = useCreateRuleV2();
  const replace = useReplaceRuleV2();
  const profilesQuery = useProfiles();
  const profile = profilesQuery.data?.find((candidate) => candidate.id === initial.profileId);
  const indicators = profile?.indicators ?? [];
  const watchlist = useWatchlist();
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const submitting = create.isPending || replace.isPending;
  const { register, handleSubmit, setValue, watch, formState, control } = useForm<RuleV2FormValues>(
    {
      resolver: yupResolver(ruleV2FormSchema),
      defaultValues: defaultValuesFor(initial),
      mode: 'onSubmit',
    },
  );
  const scopeKind = watch('scopeKind');
  const symbolId = watch('symbolId');
  const symbolIds = watch('symbolIds');
  const enabled = watch('enabled');
  const condition = watch('condition');
  const triggerKind = watch('triggerKind');
  const expirationKind = watch('expirationKind');
  const expirationAt = watch('expirationAt');
  const actions = watch('actions');
  const nameError = formState.errors.name?.message;
  const symbolError = formState.errors.symbolId?.message ?? fieldErrors['scope.symbolId'];
  const symbolsError = formState.errors.symbolIds?.message ?? fieldErrors['scope.symbolIds'];
  const expirationError = formState.errors.expirationAt?.message;
  const actionsError = formState.errors.actions?.message;
  const liveQuoteWarning = liveQuoteSubscriptionWarning(
    scopeKind,
    symbolId,
    triggerKind,
    watchlist.data ?? [],
  );

  const onSubmit: SubmitHandler<RuleV2FormValues> = async (values) => {
    setInlineError(null);
    setFieldErrors({});
    if (!isConditionTreeV2NonEmpty(values.condition)) {
      setInlineError('Every AND / OR group must have at least one child.');
      return;
    }
    if (liveQuoteWarning !== null) {
      setInlineError(liveQuoteWarning);
      return;
    }
    try {
      const payload = mergeInput(initial, values);
      if (mode === 'edit') {
        await replace.mutateAsync({ id: initial.id, patch: payload });
      } else {
        await create.mutateAsync(payload);
      }
      onOpenChange(false);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 400) {
        setInlineError(cause.message);
        setFieldErrors(fieldErrorsByPath(cause.fields));
        return;
      }
      onOpenChange(false);
    }
  };

  const title = mode === 'create' ? 'New rule' : `Edit ${initial.name}`;
  const submitLabel = mode === 'create' ? 'Create' : 'Save';
  const nameErrorId = nameError ? 'rule-v2-name-error' : undefined;
  const profileId = initial.profileId;

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
            <FieldRow label={FIELD_LABELS_V2.scope} align="start">
              <ScopePickerV2
                scopeKind={scopeKind}
                symbolId={symbolId}
                symbolIds={symbolIds}
                onScopeKindChange={(next) =>
                  setValue('scopeKind', next, { shouldDirty: true, shouldValidate: false })
                }
                onSymbolIdChange={(next) =>
                  setValue('symbolId', next, { shouldDirty: true, shouldValidate: false })
                }
                onSymbolIdsChange={(next) =>
                  setValue('symbolIds', next, { shouldDirty: true, shouldValidate: false })
                }
                symbolError={symbolError}
                symbolsError={symbolsError}
              />
            </FieldRow>
            <Separator size="4" my="1" />

            <FieldRow label={FIELD_LABELS_V2.condition} align="start">
              <ConditionTreeEditorV2
                value={condition}
                onChange={(next) =>
                  setValue('condition', next, { shouldDirty: true, shouldValidate: false })
                }
                indicators={indicators}
                profileId={profileId}
                symbolId={scopeKind === RulesV2.RuleScopeKind.Symbol ? symbolId : undefined}
                fieldErrors={fieldErrors}
              />
            </FieldRow>

            <Separator size="4" my="1" />

            <FieldRow label={FIELD_LABELS_V2.trigger} align="start">
              <TriggerPickerV2 control={control} />
            </FieldRow>
            <FieldRow label={FIELD_LABELS_V2.expiration} align="start">
              <ExpirationPickerV2
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

            <FieldRow label={FIELD_LABELS_V2.actions} align="start">
              <ActionsEditorV2
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
            {liveQuoteWarning !== null && inlineError === null ? (
              <Callout.Root color="amber" role="alert">
                <Callout.Text>{liveQuoteWarning}</Callout.Text>
              </Callout.Root>
            ) : null}
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
 * Build the per-field error map indexed by API path
 * (`scope.symbolId` / `condition.children[0].leaf.right` / …). Last entry wins
 * when a path repeats — rare, and the picker only renders one message anyway.
 */
function fieldErrorsByPath(fields: ApiFieldError[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of fields) map[entry.path] = entry.message;
  return map;
}

/**
 * Compute the per-tick subscription warning. Returns the warning text when the
 * trigger is per-tick (`EveryTime` / `Once`) and the `Symbol` scope's target
 * symbol has no live quote subscription (per #395's rejection). Returns `null`
 * otherwise.
 */
function liveQuoteSubscriptionWarning(
  scopeKind: RulesV2.RuleScopeKind,
  symbolId: string,
  triggerKind: RulesV2.TriggerKind,
  watched: Array<{ id: string; quote: unknown }>,
): string | null {
  const perTick =
    triggerKind === RulesV2.TriggerKind.EveryTime || triggerKind === RulesV2.TriggerKind.Once;
  if (!perTick) return null;
  if (scopeKind !== RulesV2.RuleScopeKind.Symbol) return null;
  if (symbolId === '') return null;
  const symbol = watched.find((entry) => entry.id === symbolId);
  if (symbol === undefined) return null;
  if (symbol.quote === null) {
    return `${symbolId} has no live quote subscription — per-tick triggers will never fire on it.`;
  }
  return null;
}

/**
 * Project the v2 form values onto a {@link RuleV2Input} payload — preserves
 * the initial rule's stable fields (id / createdAt / updatedAt are stripped)
 * and substitutes the form's edits.
 */
function mergeInput(initial: RulesV2.Rule, values: RuleV2FormValues): RuleV2Input {
  return {
    profileId: initial.profileId,
    name: values.name.trim(),
    description: values.description,
    scope: scopeV2FromForm(values),
    condition: values.condition,
    trigger: triggerV2FromForm(values),
    expiration: expirationV2FromForm(values),
    actions: values.actions,
    enabled: values.enabled,
    order: initial.order,
  };
}

/** Build the form's default values from the initial rule (create or edit). */
function defaultValuesFor(initial: RulesV2.Rule): RuleV2FormValues {
  return {
    name: initial.name,
    description: initial.description ?? '',
    ...scopeV2ToForm(initial.scope),
    enabled: initial.enabled,
    condition: initial.condition,
    ...triggerV2ToForm(initial.trigger),
    expirationKind: initial.expiration === null ? ExpirationKindV2.Never : ExpirationKindV2.OnDate,
    expirationAt: initial.expiration === null ? '' : epochMsToDateTimeLocal(initial.expiration.at),
    actions: initial.actions,
  };
}

/** `<input type="datetime-local">` reads/writes `YYYY-MM-DDTHH:mm` (local). */
function epochMsToDateTimeLocal(at: number): string {
  const d = new Date(at);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * A label-left / control-right form row — mirrors v1's `FieldRow`.
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
 * The destructive footer action — a trash button + confirmation dialog that
 * fires {@link useDeleteRuleV2} then closes the editor via `onDeleted`.
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
