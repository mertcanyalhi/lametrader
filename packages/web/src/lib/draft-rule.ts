import {
  ConditionNodeKind,
  type Rule,
  type RuleScope,
  RuleScopeKind,
  TriggerKind,
} from '@lametrader/core';

/**
 * Build a placeholder v2 {@link Rule} the create-mode editor can use as
 * its `initial`. The form values overwrite every field except `profileId` and
 * `order` before the server round-trip — the placeholder exists so the
 * editor's `initial` slot stays populated and its Save button stays enabled.
 *
 * Lazy: `order` is fixed at `1`; the server / a future reorder PUT decides the
 * real position. Persistence-only fields (`id`, `createdAt`, `updatedAt`) are
 * placeholders that the editor strips before submit.
 */
export function makeDraftRule({
  profileId,
  symbolId,
}: {
  profileId: string;
  symbolId?: string;
}): Rule {
  const scope: RuleScope =
    symbolId !== undefined
      ? { kind: RuleScopeKind.Symbol, symbolId }
      : { kind: RuleScopeKind.AllSymbols };
  return {
    id: '',
    profileId,
    name: '',
    order: 1,
    scope,
    condition: { kind: ConditionNodeKind.And, children: [] },
    trigger: { kind: TriggerKind.Once },
    expiration: null,
    actions: [],
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
  };
}
