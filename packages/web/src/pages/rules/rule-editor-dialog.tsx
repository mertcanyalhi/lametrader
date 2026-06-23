import { yupResolver } from '@hookform/resolvers/yup';
import { type ConditionNode, ConditionNodeKind, type Rule, RuleScopeKind } from '@lametrader/core';
import {
  Box,
  Button,
  Callout,
  Dialog,
  Flex,
  RadioGroup,
  Select,
  Switch,
  Text,
  TextArea,
  TextField,
} from '@radix-ui/themes';
import { type ReactNode, useState } from 'react';
import { type SubmitHandler, useForm } from 'react-hook-form';
import { ApiError } from '../../lib/api-fetch.js';
import { useProfiles } from '../../lib/hooks/profiles.js';
import { type RuleInput, useCreateRule, useReplaceRule } from '../../lib/hooks/rules.js';
import { useWatchlist } from '../../lib/hooks/symbols.js';
import {
  FIELD_LABELS,
  isConditionTreeNonEmpty,
  type RuleFormValues,
  ruleFormSchema,
} from '../../lib/rule-form-schema.js';
import { ConditionTreeEditor } from './condition-tree-editor.js';

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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  initial?: Rule;
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
  const nameError = formState.errors.name?.message;
  const symbolError = formState.errors.symbolId?.message;

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
      <Dialog.Content maxWidth="560px">
        <Dialog.Title>{title}</Dialog.Title>
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <Flex direction="column" gap="3" mt="3">
            <Box>
              <Text as="label" htmlFor="rule-name" size="2" weight="medium">
                {FIELD_LABELS.name}
              </Text>
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
            </Box>
            <Box>
              <Text as="label" htmlFor="rule-description" size="2" weight="medium">
                {FIELD_LABELS.description}
              </Text>
              <TextArea
                id="rule-description"
                aria-label={FIELD_LABELS.description}
                {...register('description')}
              />
            </Box>
            <Box>
              <Text as="div" size="2" weight="medium" mb="1">
                {FIELD_LABELS.scope}
              </Text>
              <RadioGroup.Root
                value={scopeKind}
                onValueChange={(value) =>
                  setValue('scopeKind', value as RuleScopeKind, {
                    shouldDirty: true,
                    shouldValidate: false,
                  })
                }
                aria-label={FIELD_LABELS.scope}
              >
                <RadioGroup.Item value={RuleScopeKind.Symbol}>One symbol</RadioGroup.Item>
                <RadioGroup.Item value={RuleScopeKind.AllSymbols}>All symbols</RadioGroup.Item>
              </RadioGroup.Root>
            </Box>
            {scopeKind === RuleScopeKind.Symbol ? (
              <Box>
                <Text as="div" size="2" weight="medium" mb="1">
                  {FIELD_LABELS.symbolId}
                </Text>
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
              </Box>
            ) : null}
            <Box>
              <Text as="div" size="2" weight="medium" mb="1">
                {FIELD_LABELS.condition}
              </Text>
              <ConditionTreeEditor
                value={condition}
                onChange={(next) =>
                  setValue('condition', next, { shouldDirty: true, shouldValidate: false })
                }
                indicators={indicators}
              />
            </Box>
            <Flex align="center" gap="2">
              <Switch
                id="rule-enabled"
                checked={enabled}
                onCheckedChange={(next) =>
                  setValue('enabled', next === true, { shouldDirty: true, shouldValidate: false })
                }
              />
              <Text as="label" htmlFor="rule-enabled" size="2">
                {FIELD_LABELS.enabled}
              </Text>
            </Flex>
            {inlineError ? (
              <Callout.Root color="red" role="alert">
                <Callout.Text>{inlineError}</Callout.Text>
              </Callout.Root>
            ) : null}
          </Flex>
          <Flex gap="3" mt="5" justify="end">
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
        </form>
      </Dialog.Content>
    </Dialog.Root>
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
    };
  }
  return {
    name: initial.name,
    description: initial.description ?? '',
    scopeKind: initial.scope.kind,
    symbolId: initial.scope.kind === RuleScopeKind.Symbol ? initial.scope.symbolId : '',
    enabled: initial.enabled,
    condition: initial.condition,
  };
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
  };
}
