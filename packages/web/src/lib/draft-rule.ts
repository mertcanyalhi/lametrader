import {
  ActionKind,
  ConditionNodeKind,
  type Expiration,
  type Rule,
  RuleScopeKind,
  StateValueType,
  TriggerKind,
} from '@lametrader/core';

/**
 * Build a placeholder {@link Rule} the create-mode `RuleEditorDialog` can
 * use as its `initial`. The form values overwrite every field except
 * `profileId` and `order` before the server round-trip — the placeholder
 * exists so the dialog's `initial` slot stays populated and its Save
 * button stays enabled.
 *
 * Lazy: `order` is fixed at `1`; the server / a future reorder PUT decides
 * the real position. Persistence-only fields (`id`, `events`, `history`,
 * `createdAt`, `updatedAt`) are placeholders that `mergeInput` strips.
 */
export function makeDraftRule({
  profileId,
  symbolId,
}: {
  profileId: string;
  symbolId?: string;
}): Rule {
  const scope =
    symbolId !== undefined
      ? { kind: RuleScopeKind.Symbol as const, symbolId }
      : { kind: RuleScopeKind.AllSymbols as const };
  const expiration: Expiration = null;
  return {
    id: '',
    profileId,
    name: '',
    order: 1,
    scope,
    condition: { kind: ConditionNodeKind.And, children: [] },
    trigger: { kind: TriggerKind.Once },
    expiration,
    actions: [
      {
        kind: ActionKind.SetSymbolState,
        key: '',
        value: { type: StateValueType.Number, value: 0 },
      },
    ],
    enabled: true,
    events: [],
    history: [],
    createdAt: 0,
    updatedAt: 0,
  };
}
