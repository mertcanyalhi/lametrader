import { Type } from '@fastify/type-provider-typebox';
import {
  ActionKind,
  ConditionNodeKind,
  DESTINATION_NAME_MAX,
  NumericOperator,
  OperandKind,
  Period,
  RULE_DESCRIPTION_MAX,
  RULE_NAME_MAX,
  RuleEventType,
  RuleHistoryType,
  RuleScopeKind,
  STATE_KEY_MAX,
  StateOperator,
  StateScope,
  StateValueType,
  SYMBOL_ID_MAX,
  TELEGRAM_TEMPLATE_MAX,
  TriggerKind,
} from '@lametrader/core';

/**
 * One {@link StateValue}: a tagged value carrying its `type` discriminant
 * (`string` | `number` | `bool` | `enum`).
 */
export const StateValueSchema = Type.Union(
  [
    Type.Object(
      { type: Type.Literal(StateValueType.String), value: Type.String() },
      { additionalProperties: false },
    ),
    Type.Object(
      { type: Type.Literal(StateValueType.Number), value: Type.Number() },
      { additionalProperties: false },
    ),
    Type.Object(
      { type: Type.Literal(StateValueType.Bool), value: Type.Boolean() },
      { additionalProperties: false },
    ),
    Type.Object(
      { type: Type.Literal(StateValueType.Enum), value: Type.String() },
      { additionalProperties: false },
    ),
  ],
  {},
);

/**
 * One leaf of a rule's condition tree — `left operator right` against a
 * {@link ConditionOperand} on each side. Modeled as a single flat object (with
 * all variant keys optional) to dodge the Fastify-AJV `removeAdditional`
 * interaction with discriminated unions; the domain's parsers enforce the
 * cross-field shape (e.g. `Literal` requires `value`, refs require `key`).
 */
export const ConditionOperandSchema = Type.Object(
  {
    kind: Type.Enum(OperandKind),
    /** Carried by every non-Literal variant — the resolved {@link StateValueType}. */
    valueType: Type.Optional(Type.Enum(StateValueType)),
    /** Carried by Literal: the constant {@link StateValue}. */
    value: Type.Optional(StateValueSchema),
    /** Carried by IndicatorRef: the attached indicator instance id. */
    instanceId: Type.Optional(Type.String()),
    /** Carried by IndicatorRef: the state-field key on that instance. */
    stateKey: Type.Optional(Type.String()),
    /** Carried by SymbolStateRef / GlobalStateRef: the state-map key. */
    key: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/**
 * One node of a rule's condition tree: an `And` / `Or` group with `children`,
 * or a `Leaf` comparison. Recursive via `$ref: 'ConditionNode'` for the
 * group variants.
 */
export const ConditionNodeSchema = Type.Object(
  {
    kind: Type.Enum(ConditionNodeKind),
    /** Carried by And / Or: nested {@link ConditionNode}s. */
    children: Type.Optional(Type.Array(Type.Ref('ConditionNode'))),
    /** Carried by Leaf: the left operand. */
    left: Type.Optional(ConditionOperandSchema),
    /**
     * Carried by Leaf: the operator (numeric or state). Validated as one of
     * the merged enum set.
     */
    operator: Type.Optional(Type.Union([Type.Enum(NumericOperator), Type.Enum(StateOperator)])),
    /** Carried by Leaf: the right operand. */
    right: Type.Optional(ConditionOperandSchema),
  },
  { $id: 'ConditionNode', additionalProperties: false },
);

/**
 * One trigger gate: `Once`, `OncePerBar` / `OncePerBarClose` (with `period`),
 * or `OncePerMinute` (with `intervalMs`).
 */
export const TriggerSchema = Type.Object(
  {
    kind: Type.Enum(TriggerKind),
    period: Type.Optional(Type.Enum(Period)),
    intervalMs: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);

/**
 * A rule's expiration policy: an object `{ at }` (epoch ms) or `null` (never
 * expires).
 */
export const ExpirationSchema = Type.Union(
  [Type.Object({ at: Type.Number() }, { additionalProperties: false }), Type.Null()],
  {},
);

/**
 * One action a rule fires: state set/remove (symbol or global) or
 * Telegram notify. Flat-object shape with all variant keys optional; domain
 * parsers enforce per-kind required fields.
 */
export const ActionSchema = Type.Object(
  {
    kind: Type.Enum(ActionKind),
    /** State actions: the key being set/removed. */
    key: Type.Optional(Type.String({ maxLength: STATE_KEY_MAX })),
    /** State set actions: the value written. */
    value: Type.Optional(StateValueSchema),
    /** NotifyTelegram: the destination name from the settings layer. */
    destinationName: Type.Optional(Type.String({ maxLength: DESTINATION_NAME_MAX })),
    /** NotifyTelegram: the message template. */
    template: Type.Optional(Type.String({ maxLength: TELEGRAM_TEMPLATE_MAX })),
  },
  { additionalProperties: false },
);

/**
 * A rule's scope: `Symbol` (with `symbolId`) or `AllSymbols`.
 */
export const RuleScopeSchema = Type.Object(
  {
    kind: Type.Enum(RuleScopeKind),
    /** Carried by Symbol scope: the watched symbol id. */
    symbolId: Type.Optional(Type.String({ maxLength: SYMBOL_ID_MAX })),
  },
  { additionalProperties: false },
);

/**
 * One entry in a rule's embedded events log — tagged union over
 * {@link RuleEventType}. Per-variant fields are optional at the transport
 * layer; the engine itself produces correctly-shaped entries.
 */
export const RuleEventEntrySchema = Type.Object(
  {
    type: Type.Enum(RuleEventType),
    ts: Type.Number(),
    ruleId: Type.String(),
    symbolId: Type.String(),
    /** CycleOverflow: the breached limit. */
    cycleLimit: Type.Optional(Type.Number()),
    /** StateSet / StateRemoved: the affected scope. */
    scope: Type.Optional(Type.Enum(StateScope)),
    /** StateSet / StateRemoved: the affected key. */
    key: Type.Optional(Type.String()),
    /** StateSet: the value written. */
    value: Type.Optional(StateValueSchema),
    /** NotificationSent: the destination + rendered body. */
    destinationName: Type.Optional(Type.String()),
    body: Type.Optional(Type.String()),
    /** Error: the human-readable reason. */
    reason: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/**
 * One lifecycle entry on a rule (created / updated / enabled / disabled).
 */
export const RuleHistoryEntrySchema = Type.Object(
  {
    type: Type.Enum(RuleHistoryType),
    ts: Type.Number(),
  },
  { additionalProperties: false },
);

/**
 * A full {@link Rule} — used as the 200/201 response shape on every rule
 * route.
 */
export const RuleSchema = Type.Object(
  {
    id: Type.String(),
    profileId: Type.String(),
    name: Type.String(),
    description: Type.Optional(Type.String()),
    scope: RuleScopeSchema,
    condition: ConditionNodeSchema,
    trigger: TriggerSchema,
    expiration: ExpirationSchema,
    actions: Type.Array(ActionSchema),
    enabled: Type.Boolean(),
    order: Type.Number(),
    events: Type.Array(RuleEventEntrySchema),
    history: Type.Array(RuleHistoryEntrySchema),
    createdAt: Type.Number(),
    updatedAt: Type.Number(),
  },
  { additionalProperties: false },
);

/**
 * Body for `POST /rules` (create) and `PUT /rules/:id` (full replace) — the
 * client-controllable subset. The server generates `id`, `events`, `history`,
 * `createdAt`, `updatedAt`.
 */
export const RuleInputSchema = Type.Object(
  {
    profileId: Type.String(),
    name: Type.String({ minLength: 1, maxLength: RULE_NAME_MAX }),
    description: Type.Optional(Type.String({ maxLength: RULE_DESCRIPTION_MAX })),
    scope: RuleScopeSchema,
    condition: ConditionNodeSchema,
    trigger: TriggerSchema,
    expiration: ExpirationSchema,
    actions: Type.Array(ActionSchema),
    enabled: Type.Boolean(),
    order: Type.Number(),
  },
  { additionalProperties: false },
);

/**
 * Path params carrying a rule id.
 */
export const RuleIdParamSchema = Type.Object({ id: Type.String() });
