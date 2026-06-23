import type { Rule } from '@lametrader/core';
import { Button, Callout, Dialog, Flex } from '@radix-ui/themes';
import { type ReactNode, useState } from 'react';
import { ApiError } from '../../lib/api-fetch.js';
import { type RuleInput, useCreateRule, useReplaceRule } from '../../lib/hooks/rules.js';

/**
 * The reusable rule-editor `Dialog` shell. Owns the modal frame, the
 * create/edit mode toggle, and the save/cancel wiring against the existing
 * rules hooks. The body is intentionally empty — the field surfaces
 * (name/description/enabled, condition tree, trigger, expiration, actions)
 * land in #168–#175 and plug into the form context this shell sets up.
 *
 * The shell calls {@link useCreateRule} (create) or {@link useReplaceRule}
 * (edit) on save; 400 responses surface as an inline {@link Callout}; other
 * errors close the dialog and bubble through the mutation's normal log path.
 *
 * @param open         - Controlled open state.
 * @param onOpenChange - Controlled-open callback; closes on Cancel / save success.
 * @param mode         - `'create'` or `'edit'`; drives title + which hook fires.
 * @param initial      - The rule to seed the form with in edit mode (required) or
 *                       to pre-populate a create draft (optional).
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
  const [inlineError, setInlineError] = useState<string | null>(null);
  const submitting = create.isPending || replace.isPending;

  async function handleSave(): Promise<void> {
    setInlineError(null);
    try {
      if (mode === 'edit') {
        if (!initial) return;
        const input = toRuleInput(initial);
        await replace.mutateAsync({ id: initial.id, input });
      } else {
        if (!initial) return;
        const input = toRuleInput(initial);
        await create.mutateAsync(input);
      }
      onOpenChange(false);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 400) {
        setInlineError(cause.message);
        return;
      }
      onOpenChange(false);
    }
  }

  const title = mode === 'create' ? 'New rule' : `Edit ${initial?.name ?? 'rule'}`;
  const submitLabel = mode === 'create' ? 'Create' : 'Save';

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="560px">
        <Dialog.Title>{title}</Dialog.Title>
        {/* Lazy: body is empty until #168 adds the basic-field inputs (name,
            description, enabled) and #169–#175 add the rule sub-editors. */}
        {inlineError ? (
          <Callout.Root color="red" role="alert" mt="3">
            <Callout.Text>{inlineError}</Callout.Text>
          </Callout.Root>
        ) : null}
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
          <Button
            type="button"
            onClick={handleSave}
            loading={submitting}
            disabled={submitting || !initial}
          >
            {submitLabel}
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/** Strip the persistence-only fields from a {@link Rule} to derive its {@link RuleInput}. */
function toRuleInput(rule: Rule): RuleInput {
  const { id, events, history, createdAt, updatedAt, ...input } = rule;
  return input;
}
