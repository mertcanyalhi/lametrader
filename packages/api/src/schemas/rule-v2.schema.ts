import { Type } from '@fastify/type-provider-typebox';
import {
  DESTINATION_NAME_MAX,
  Period,
  RULE_DESCRIPTION_MAX,
  RULE_NAME_MAX,
  RulesV2,
  STATE_KEY_MAX,
  StateScope,
  StateValueType,
  SYMBOL_ID_MAX,
  TELEGRAM_TEMPLATE_MAX,
} from '@lametrader/core';

/**
 * Merged enum of every v2 leaf operator. The flat-object {@link LeafConditionSchema}
 * accepts any of them on its `operator` key; the leaf's `family` discriminator
 * dictates which set the operator must come from at the engine layer.
 */
const operatorEnum = {
  ...RulesV2.ComparisonOperator,
  ...RulesV2.CrossingOperator,
  ...RulesV2.ChannelOperator,
  ...RulesV2.MovingOperator,
  ...RulesV2.StateOperator,
} as const;

/**
 * One {@link RulesV2.StateValue}: a tagged value carrying its `type` discriminant
 * (`string` | `number` | `bool` | `enum`).
 */
export const StateValueV2Schema = Type.Union([
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
]);

/**
 * One v2 {@link RulesV2.ConditionOperand}. Modeled as a flat object with all
 * variant keys optional — same workaround the v1 schema uses to dodge the
 * Fastify-AJV `removeAdditional` interaction with discriminated unions; the
 * engine trusts the schema per ADR 0016 #11 and ignores absent slots.
 */
export const ConditionOperandV2Schema = Type.Object(
  {
    kind: Type.Enum(RulesV2.OperandKind),
    /** Literal: the constant {@link RulesV2.StateValue}. */
    value: Type.Optional(StateValueV2Schema),
    /** IndicatorRef: the profile-attached indicator instance id. */
    instanceId: Type.Optional(Type.String()),
    /** IndicatorRef: the state-field key on that instance. */
    stateKey: Type.Optional(Type.String({ maxLength: STATE_KEY_MAX })),
    /** SymbolStateRef / GlobalStateRef: the state-map key. */
    key: Type.Optional(Type.String({ maxLength: STATE_KEY_MAX })),
    /** IndicatorRef / SymbolStateRef / GlobalStateRef: the value type the ref resolves to. */
    valueType: Type.Optional(Type.Enum(StateValueType)),
  },
  { additionalProperties: false },
);

/**
 * One v2 {@link RulesV2.LeafCondition}. Flat object with all family-specific
 * keys optional; the engine dispatches by `family`.
 */
export const LeafConditionV2Schema = Type.Object(
  {
    family: Type.Enum(RulesV2.LeafConditionFamily),
    operator: Type.Enum(operatorEnum),
    left: ConditionOperandV2Schema,
    /** Comparison / Crossing / State: the right operand. */
    right: Type.Optional(ConditionOperandV2Schema),
    /** Channel: the lower bound operand. */
    lower: Type.Optional(ConditionOperandV2Schema),
    /** Channel: the upper bound operand. */
    upper: Type.Optional(ConditionOperandV2Schema),
    /** Moving: the scalar threshold (absolute units or %). */
    threshold: Type.Optional(Type.Number()),
    /** Moving: the integer bar lookback. */
    lookbackBars: Type.Optional(Type.Integer({ minimum: 1 })),
    /** OHLCV / Crossing / Channel / Moving / IndicatorRef leaves: bar period disambiguator. */
    interval: Type.Optional(Type.Enum(Period)),
  },
  { additionalProperties: false },
);

/**
 * One node of a v2 rule's condition tree — recursive via `$ref` for And/Or
 * children.
 */
export const ConditionNodeV2Schema = Type.Object(
  {
    kind: Type.Enum(RulesV2.ConditionNodeKind),
    /** And / Or: nested {@link RulesV2.ConditionNode}s. */
    children: Type.Optional(Type.Array(Type.Ref('ConditionNodeV2'))),
    /** Leaf: the embedded {@link RulesV2.LeafCondition}. */
    leaf: Type.Optional(LeafConditionV2Schema),
  },
  { $id: 'ConditionNodeV2', additionalProperties: false },
);

/**
 * One v2 trigger: six tagged variants. Flat object with `period` / `intervalMs`
 * optional — required per-kind by the engine, allowed empty by the schema for
 * `EveryTime` / `Once`.
 */
export const TriggerV2Schema = Type.Object(
  {
    kind: Type.Enum(RulesV2.TriggerKind),
    period: Type.Optional(Type.Enum(Period)),
    intervalMs: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

/**
 * A v2 rule's expiration: `{ at }` or `null` (never expires).
 */
export const ExpirationV2Schema = Type.Union([
  Type.Object({ at: Type.Number() }, { additionalProperties: false }),
  Type.Null(),
]);

/**
 * One v2 {@link RulesV2.Action}. Flat-object with all variant keys optional;
 * the engine dispatches by `kind`.
 */
export const ActionV2Schema = Type.Object(
  {
    kind: Type.Enum(RulesV2.ActionKind),
    /** Notification: the channel discriminator (only Telegram at v2 launch). */
    channel: Type.Optional(Type.Enum(RulesV2.NotificationChannel)),
    /** Notification: the destination name. */
    destinationName: Type.Optional(Type.String({ maxLength: DESTINATION_NAME_MAX })),
    /** Notification: the message template. */
    template: Type.Optional(Type.String({ maxLength: TELEGRAM_TEMPLATE_MAX })),
    /** State actions: the affected key. */
    key: Type.Optional(Type.String({ maxLength: STATE_KEY_MAX })),
    /** SetSymbolState / SetGlobalState: the value written. */
    value: Type.Optional(StateValueV2Schema),
  },
  { additionalProperties: false },
);

/**
 * A v2 {@link RulesV2.RuleScope}: `Symbol`, `Symbols(list)`, or `AllSymbols`.
 */
export const RuleScopeV2Schema = Type.Object(
  {
    kind: Type.Enum(RulesV2.RuleScopeKind),
    /** Symbol: the single watched symbol id. */
    symbolId: Type.Optional(Type.String({ maxLength: SYMBOL_ID_MAX })),
    /** Symbols: the explicit list of watched symbol ids. */
    symbolIds: Type.Optional(Type.Array(Type.String({ maxLength: SYMBOL_ID_MAX }))),
  },
  { additionalProperties: false },
);

/**
 * One inbound {@link RulesV2.EvaluationTriggerEvent} as inlined on a `Fired`
 * event-log entry. Flat-object shape; the engine populates per-kind fields.
 */
export const EvaluationTriggerEventV2Schema = Type.Object(
  {
    kind: Type.Enum(RulesV2.EvaluationTriggerKind),
    ts: Type.Number(),
    /** Tick / BarOpened / BarClosed / IndicatorChanged / SymbolStateChanged. */
    symbolId: Type.Optional(Type.String()),
    /** Tick: the live price. */
    price: Type.Optional(Type.Number()),
    /** BarOpened / BarClosed / IndicatorChanged. */
    period: Type.Optional(Type.Enum(Period)),
    /** IndicatorChanged: the indicator instance id. */
    instanceId: Type.Optional(Type.String()),
    /** IndicatorChanged / SymbolStateChanged / GlobalStateChanged: the state-key. */
    stateKey: Type.Optional(Type.String()),
    /** SymbolStateChanged / GlobalStateChanged. */
    profileId: Type.Optional(Type.String()),
    /** SymbolStateChanged / GlobalStateChanged: the state-map key. */
    key: Type.Optional(Type.String()),
    /** SymbolStateChanged / GlobalStateChanged / IndicatorChanged: the prev value (or null). */
    prev: Type.Optional(Type.Union([StateValueV2Schema, Type.Null()])),
    /** SymbolStateChanged / GlobalStateChanged / IndicatorChanged: the current value (or null). */
    current: Type.Optional(Type.Union([StateValueV2Schema, Type.Null()])),
  },
  { additionalProperties: false },
);

/**
 * One entry in a v2 rule's mirrored events log — tagged union over
 * {@link RulesV2.RuleEventType}. Per-variant fields are optional at the
 * transport layer; the engine itself produces correctly-shaped entries.
 */
export const RuleEventEntryV2Schema = Type.Object(
  {
    type: Type.Enum(RulesV2.RuleEventType),
    ts: Type.Number(),
    firedAt: Type.Optional(Type.Number()),
    ruleId: Type.String(),
    symbolId: Type.String(),
    /** Fired: the inbound event + the firing symbol's OHLCV snapshot. */
    context: Type.Optional(
      Type.Object(
        {
          inboundEvent: EvaluationTriggerEventV2Schema,
          lookupSnapshot: Type.Object(
            {
              current: Type.Union([Type.Number(), Type.Null()]),
              open: Type.Union([Type.Number(), Type.Null()]),
              high: Type.Union([Type.Number(), Type.Null()]),
              low: Type.Union([Type.Number(), Type.Null()]),
              close: Type.Union([Type.Number(), Type.Null()]),
              volume: Type.Union([Type.Number(), Type.Null()]),
            },
            { additionalProperties: false },
          ),
        },
        { additionalProperties: false },
      ),
    ),
    /** CycleOverflow: the breached limit. */
    cycleLimit: Type.Optional(Type.Number()),
    /** StateSet / StateRemoved: the affected scope. */
    scope: Type.Optional(Type.Enum(StateScope)),
    /** StateSet / StateRemoved: the affected key. */
    key: Type.Optional(Type.String()),
    /** StateSet: the value written. */
    value: Type.Optional(StateValueV2Schema),
    /** NotificationSent: the destination + rendered body. */
    destinationName: Type.Optional(Type.String()),
    body: Type.Optional(Type.String()),
    /** Error: the human-readable reason. */
    reason: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/**
 * A full v2 {@link RulesV2.Rule} — used as the 200/201 response shape on every
 * `/v2/rules` route.
 */
export const RuleV2Schema = Type.Object(
  {
    id: Type.String(),
    profileId: Type.String(),
    name: Type.String(),
    description: Type.Optional(Type.String()),
    scope: RuleScopeV2Schema,
    condition: ConditionNodeV2Schema,
    trigger: TriggerV2Schema,
    expiration: ExpirationV2Schema,
    actions: Type.Array(ActionV2Schema),
    enabled: Type.Boolean(),
    order: Type.Number(),
    createdAt: Type.Number(),
    updatedAt: Type.Number(),
  },
  { additionalProperties: false },
);

/**
 * Body for `POST /v2/rules` (create) — the client-controllable subset of a v2
 * rule. The server generates `id`, `createdAt`, `updatedAt`.
 */
export const RuleV2InputSchema = Type.Object(
  {
    profileId: Type.String(),
    name: Type.String({ minLength: 1, maxLength: RULE_NAME_MAX }),
    description: Type.Optional(Type.String({ maxLength: RULE_DESCRIPTION_MAX })),
    scope: RuleScopeV2Schema,
    condition: ConditionNodeV2Schema,
    trigger: TriggerV2Schema,
    expiration: ExpirationV2Schema,
    actions: Type.Array(ActionV2Schema, { minItems: 1 }),
    enabled: Type.Boolean(),
    order: Type.Number(),
  },
  { additionalProperties: false },
);

/**
 * Body for `PATCH /v2/rules/:id` — every field is optional (merge semantics).
 * The engine re-validates the merged rule against the boundary schema.
 */
export const RuleV2PatchSchema = Type.Object(
  {
    profileId: Type.Optional(Type.String()),
    name: Type.Optional(Type.String({ minLength: 1, maxLength: RULE_NAME_MAX })),
    description: Type.Optional(Type.String({ maxLength: RULE_DESCRIPTION_MAX })),
    scope: Type.Optional(RuleScopeV2Schema),
    condition: Type.Optional(ConditionNodeV2Schema),
    trigger: Type.Optional(TriggerV2Schema),
    expiration: Type.Optional(ExpirationV2Schema),
    actions: Type.Optional(Type.Array(ActionV2Schema, { minItems: 1 })),
    enabled: Type.Optional(Type.Boolean()),
    order: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);

/** Path params carrying a rule id. */
export const RuleV2IdParamSchema = Type.Object({ id: Type.String() });

/** Path params carrying a symbol id. */
export const SymbolV2IdParamSchema = Type.Object({ id: Type.String() });

/**
 * Query parameters for `GET /v2/rules`: each filter independent, all optional.
 */
export const RuleV2ListQuerySchema = Type.Object(
  {
    profileId: Type.Optional(Type.String()),
    symbolId: Type.Optional(Type.String()),
    enabled: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

/**
 * Query parameters for the event-log read endpoints.
 */
export const RuleV2EventsQuerySchema = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
    before: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);
