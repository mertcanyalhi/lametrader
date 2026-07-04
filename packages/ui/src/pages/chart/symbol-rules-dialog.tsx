import type { Rule } from '@lametrader/core';
import { Badge, Button, Callout, Dialog, Flex, Skeleton, Text } from '@radix-ui/themes';
import { ListChecks, Plus, TriangleAlert } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { makeDraftRule } from '../../lib/draft-rule.js';
import { useRules } from '../../lib/hooks/rules.js';
import { useSelectedProfile } from '../../lib/selected-profile-context.js';
import { RuleEditorDialog } from '../rules/rule-editor-dialog.js';
import { RuleEventsDialog } from '../rules/rule-events-dialog.js';
import { RulesTable } from '../rules/rules-table.js';

/** Cap rendered on the trigger badge above this threshold. */
const COUNT_BADGE_CAP = 99;

/**
 * Render the count for the Rules trigger badge — integers up to
 * {@link COUNT_BADGE_CAP}; anything above renders as `99+`.
 */
function renderCount(count: number): string {
  if (count > COUNT_BADGE_CAP) return `${COUNT_BADGE_CAP}+`;
  return String(count);
}

/**
 * The chart's bottom-bar Rules panel — a trigger button labeled with the
 * current symbol's rule count, opening a dialog that renders the shared
 * {@link RulesTable} with `columns.scope` omitted (scope is implicitly the
 * current symbol).
 *
 * The dialog hosts a `+ New rule` button pre-scoped to the chart's symbol,
 * plus the row actions (Edit / Events / Delete) the shared table exposes.
 *
 * When no profile is selected, the dialog renders a warning callout pointing
 * to the profile picker (no `+ New rule` button — there is nothing to attach
 * the rule to). The trigger then renders just `Rules` (no count badge),
 * mirroring the indicator panel's no-profile copy.
 *
 * @param symbolId - the symbol whose rules the dialog scopes to.
 */
export function SymbolRulesDialog({ symbolId }: { symbolId: string }): ReactNode {
  const { profileId } = useSelectedProfile();
  if (profileId === null) {
    return <NoProfileTrigger />;
  }
  return <ScopedDialog profileId={profileId} symbolId={symbolId} />;
}

/**
 * The dialog when a profile IS selected — fetches the symbol-scoped rules
 * list, renders the count badge, and hosts the shared `RulesTable` plus the
 * three editor sub-dialogs (create / edit / events).
 */
function ScopedDialog({ profileId, symbolId }: { profileId: string; symbolId: string }): ReactNode {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [eventsRule, setEventsRule] = useState<Rule | null>(null);

  // The server's symbol filter covers `Symbol`, `Symbols(list)`, and
  // `AllSymbols` scopes — every rule whose scope applies to this symbol.
  const rulesQuery = useRules({ profileId, symbolId });
  const rules = rulesQuery.data ?? [];

  // A child editor/events dialog is portaled outside this content; closing it
  // (Cancel / Esc) bounces focus through <body>, which this dialog's dismiss
  // layer sees as an outside-interaction and would close on. The ref lags the
  // child state by a macrotask so the guard is still armed when that late event
  // lands (reading current state here fires too early — state is already false).
  // ponytail: single boolean assumes one child open at a time (true here).
  const childOpenRef = useRef(false);
  useEffect(() => {
    if (creating || editing !== null || eventsRule !== null) {
      childOpenRef.current = true;
      return;
    }
    const id = setTimeout(() => {
      childOpenRef.current = false;
    }, 0);
    return () => clearTimeout(id);
  }, [creating, editing, eventsRule]);

  return (
    <>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger>
          <Button
            variant="soft"
            color="gray"
            className="min-w-32 justify-center"
            aria-label={`Rules (${renderCount(rules.length)})`}
          >
            <ListChecks size={14} aria-hidden="true" />
            Rules
            <Badge variant="soft" color="gray" radius="full">
              {renderCount(rules.length)}
            </Badge>
          </Button>
        </Dialog.Trigger>
        <Dialog.Content
          maxWidth="900px"
          onInteractOutside={(event) => {
            if (childOpenRef.current) event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            if (childOpenRef.current) event.preventDefault();
          }}
        >
          <Flex align="center" justify="between" gap="3">
            <Dialog.Title mb="0">
              Rules{' '}
              <Text as="span" size="4" weight="regular" color="gray">
                {symbolId}
              </Text>
            </Dialog.Title>
            <Button onClick={() => setCreating(true)}>
              <Plus size={16} aria-hidden="true" />
              New rule
            </Button>
          </Flex>
          <Flex direction="column" gap="3" mt="3">
            {rulesQuery.isPending ? (
              <Skeleton height="1.25rem" width="10rem" />
            ) : rulesQuery.isError ? (
              <Callout.Root color="red" role="alert">
                <Callout.Text>{rulesQuery.error.message}</Callout.Text>
              </Callout.Root>
            ) : rules.length === 0 ? (
              <Text size="2" color="gray">
                No rules yet — create one to start firing notifications and state mutations.
              </Text>
            ) : (
              <RulesTable
                rules={rules}
                columns={{ scope: false }}
                onEdit={setEditing}
                onEvents={setEventsRule}
              />
            )}
          </Flex>
          <Flex gap="3" mt="4" justify="end">
            <Dialog.Close>
              <Button variant="soft" color="gray">
                Close
              </Button>
            </Dialog.Close>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
      {creating ? (
        <RuleEditorDialog
          open={true}
          onOpenChange={(next) => {
            if (!next) setCreating(false);
          }}
          mode="create"
          initial={makeDraftRule({ profileId, symbolId })}
        />
      ) : null}
      {editing ? (
        <RuleEditorDialog
          open={true}
          onOpenChange={(next) => {
            if (!next) setEditing(null);
          }}
          mode="edit"
          initial={editing}
        />
      ) : null}
      {eventsRule ? (
        <RuleEventsDialog
          rule={eventsRule}
          open={true}
          onOpenChange={(next) => {
            if (!next) setEventsRule(null);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * The trigger + dialog body when no profile is selected — the dialog renders
 * a warning callout pointing to the profile picker. The trigger shows just
 * `Rules` (no count badge), mirroring the indicator panel's no-profile copy.
 */
function NoProfileTrigger(): ReactNode {
  return (
    <Dialog.Root>
      <Dialog.Trigger>
        <Button variant="soft" color="gray" className="min-w-32 justify-center" aria-label="Rules">
          <ListChecks size={14} aria-hidden="true" />
          Rules
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="520px">
        <Dialog.Title>Rules</Dialog.Title>
        <Callout.Root color="amber" mt="3">
          <Callout.Icon>
            <TriangleAlert size={16} aria-hidden="true" />
          </Callout.Icon>
          <Callout.Text>Select or create a profile to manage rules.</Callout.Text>
        </Callout.Root>
        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray">
              Close
            </Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
