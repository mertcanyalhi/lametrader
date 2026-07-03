import { Type } from '@fastify/type-provider-typebox';
import {
  ActionKind,
  ChannelOperator,
  ComparisonOperator,
  ConditionNodeKind,
  CrossingOperator,
  DESTINATION_NAME_MAX,
  EvaluationTriggerKind,
  LeafConditionFamily,
  MovingOperator,
  NotificationChannel,
  OperandKind,
  Period,
  RULE_DESCRIPTION_MAX,
  RULE_NAME_MAX,
  RuleEventType,
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
 * Merged enum of every leaf operator. The flat-object {@link LeafConditionSchema}
 * accepts any of them on its `operator` key; the leaf's `family` discriminator
 * dictates which set the operator must come from at the engine layer.
 */
const operatorEnum = {
  ...ComparisonOperator,
  ...CrossingOperator,
  ...ChannelOperator,
  ...MovingOperator,
  ...StateOperator,
} as const;

/**
 * One {@link StateValue}: a tagged value carrying its `type` discriminant
 * (`string` | `number` | `bool` | `enum`).
 */
export const StateValueSchema = Type.Union([
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
]);

/**
 * One {@link ConditionOperand}. Modeled as a flat object with all variant
 * keys optional — the engine trusts the schema per ADR 0016 #11 and ignores
 * absent slots.
 */
export const ConditionOperandSchema = Type.Object(
  {
    kind: Type.Enum(OperandKind),
    /** Literal: the constant {@link StateValue}. */
    value: Type.Optional(StateValueSchema),
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
 * One {@link LeafCondition}. Flat object with all family-specific keys
 * optional; the engine dispatches by `family`.
 */
export const LeafConditionSchema = Type.Object(
  {
    family: Type.Enum(LeafConditionFamily),
    operator: Type.Enum(operatorEnum),
    left: ConditionOperandSchema,
    /** Comparison / Crossing / State: the right operand. */
    right: Type.Optional(ConditionOperandSchema),
    /** Channel: the lower bound operand. */
    lower: Type.Optional(ConditionOperandSchema),
    /** Channel: the upper bound operand. */
    upper: Type.Optional(ConditionOperandSchema),
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
 * One node of a rule's condition tree — recursive via `$ref` for And/Or
 * children.
 */
export const ConditionNodeSchema = Type.Object(
  {
    kind: Type.Enum(ConditionNodeKind),
    /** And / Or: nested {@link ConditionNode}s. */
    children: Type.Optional(Type.Array(Type.Ref('ConditionNode'))),
    /** Leaf: the embedded {@link LeafCondition}. */
    leaf: Type.Optional(LeafConditionSchema),
  },
  { $id: 'ConditionNode', additionalProperties: false },
);

/**
 * One trigger: six tagged variants. Flat object with `period` / `intervalMs`
 * optional — required per-kind by the engine, allowed empty by the schema for
 * `EveryTime` / `Once`.
 */
export const TriggerSchema = Type.Object(
  {
    kind: Type.Enum(TriggerKind),
    period: Type.Optional(Type.Enum(Period)),
    intervalMs: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

/**
 * A rule's expiration: `{ at }` or `null` (never expires).
 */
export const ExpirationSchema = Type.Union([
  Type.Object({ at: Type.Number() }, { additionalProperties: false }),
  Type.Null(),
]);

/**
 * One {@link Action}. Flat-object with all variant keys optional; the engine
 * dispatches by `kind`.
 */
export const ActionSchema = Type.Object(
  {
    kind: Type.Enum(ActionKind),
    /** Notification: the channel discriminator (only Telegram at launch). */
    channel: Type.Optional(Type.Enum(NotificationChannel)),
    /** Notification: the destination name. */
    destinationName: Type.Optional(Type.String({ maxLength: DESTINATION_NAME_MAX })),
    /** Notification: the message template. */
    template: Type.Optional(Type.String({ maxLength: TELEGRAM_TEMPLATE_MAX })),
    /** State actions: the affected key. */
    key: Type.Optional(Type.String({ maxLength: STATE_KEY_MAX })),
    /** SetSymbolState / SetGlobalState: the value written. */
    value: Type.Optional(StateValueSchema),
  },
  { additionalProperties: false },
);

/**
 * A {@link RuleScope}: `Symbol`, `Symbols(list)`, or `AllSymbols`.
 */
export const RuleScopeSchema = Type.Object(
  {
    kind: Type.Enum(RuleScopeKind),
    /** Symbol: the single watched symbol id. */
    symbolId: Type.Optional(Type.String({ maxLength: SYMBOL_ID_MAX })),
    /** Symbols: the explicit list of watched symbol ids. */
    symbolIds: Type.Optional(Type.Array(Type.String({ maxLength: SYMBOL_ID_MAX }))),
  },
  { additionalProperties: false },
);

/**
 * One inbound {@link EvaluationTriggerEvent} as inlined on a `Fired`
 * event-log entry. Flat-object shape; the engine populates per-kind fields.
 */
export const EvaluationTriggerEventSchema = Type.Object(
  {
    kind: Type.Enum(EvaluationTriggerKind),
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
    /** SymbolStateChanged / GlobalStateChanged / IndicatorChanged. */
    profileId: Type.Optional(Type.String()),
    /** SymbolStateChanged / GlobalStateChanged: the state-map key. */
    key: Type.Optional(Type.String()),
    /**
     * SymbolStateChanged / GlobalStateChanged / IndicatorChanged: the prev
     * value (or null). Also allows a raw `number`: the append-only log holds
     * `Fired` entries from earlier engine versions that inlined OHLCV
     * data-update events (numeric `prev`/`current`) as the firing inbound.
     */
    prev: Type.Optional(Type.Union([StateValueSchema, Type.Number(), Type.Null()])),
    /** As {@link prev}: current value — `StateValue`, raw `number` (legacy), or null. */
    current: Type.Optional(Type.Union([StateValueSchema, Type.Number(), Type.Null()])),
  },
  { additionalProperties: false },
);

/**
 * One entry in a rule's mirrored events log — tagged union over
 * {@link RuleEventType}. Per-variant fields are optional at the transport
 * layer; the engine itself produces correctly-shaped entries.
 */
export const RuleEventEntrySchema = Type.Object(
  {
    type: Type.Enum(RuleEventType),
    ts: Type.Number(),
    firedAt: Type.Optional(Type.Number()),
    ruleId: Type.String(),
    symbolId: Type.String(),
    /** Fired: the inbound event + the firing symbol's OHLCV snapshot. */
    context: Type.Optional(
      Type.Object(
        {
          inboundEvent: EvaluationTriggerEventSchema,
          lookupSnapshot: Type.Object(
            {
              /** The bar period the OHLCV axes were captured at; absent on legacy entries. */
              period: Type.Optional(Type.Enum(Period)),
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
 * A full {@link Rule} — used as the 200/201 response shape on every
 * `/rules` route.
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
    createdAt: Type.Number(),
    updatedAt: Type.Number(),
    lastFiredAt: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);

/**
 * Body for `POST /rules` (create) — the client-controllable subset of a
 * rule. The server generates `id`, `createdAt`, `updatedAt`.
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
    actions: Type.Array(ActionSchema, { minItems: 1 }),
    enabled: Type.Boolean(),
    order: Type.Number(),
  },
  { additionalProperties: false },
);

/**
 * Body for `PATCH /rules/:id` — every field is optional (merge semantics).
 * The engine re-validates the merged rule against the boundary schema.
 */
export const RulePatchSchema = Type.Object(
  {
    profileId: Type.Optional(Type.String()),
    name: Type.Optional(Type.String({ minLength: 1, maxLength: RULE_NAME_MAX })),
    description: Type.Optional(Type.String({ maxLength: RULE_DESCRIPTION_MAX })),
    scope: Type.Optional(RuleScopeSchema),
    condition: Type.Optional(ConditionNodeSchema),
    trigger: Type.Optional(TriggerSchema),
    expiration: Type.Optional(ExpirationSchema),
    actions: Type.Optional(Type.Array(ActionSchema, { minItems: 1 })),
    enabled: Type.Optional(Type.Boolean()),
    order: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);

/** Path params carrying a rule id. */
export const RuleIdParamSchema = Type.Object({ id: Type.String() });

/** Path params carrying a symbol id. */
export const SymbolIdParamSchema = Type.Object({ id: Type.String() });

/**
 * Query parameters for `GET /rules`: each filter independent, all optional.
 */
export const RuleListQuerySchema = Type.Object(
  {
    profileId: Type.Optional(Type.String()),
    symbolId: Type.Optional(Type.String()),
    enabled: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

/**
 * Query parameters for the event-log read endpoints.
 *
 * `from` and `to` bound the entry's source `ts` (inclusive lower, exclusive
 * upper) and back the chart's visible-window read; `before` is the older
 * "next page" cursor and ANDs with the window.
 */
export const RuleEventsQuerySchema = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
    before: Type.Optional(Type.Number()),
    from: Type.Optional(Type.Number()),
    to: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);

/**
 * Query parameters for `GET /symbols/:id/rule-events` — the windowed event
 * read backing the chart's markers.
 *
 * Extends {@link RuleEventsQuerySchema}'s `limit` / `before` / `from` / `to`
 * with an optional `chartStates` filter: a JSON-encoded array of state keys
 * (e.g. `["price:trend"]`).
 * A single JSON string carries the whole set because a repeated query param
 * cannot distinguish an **empty** array (present ⇒ render nothing) from an
 * **absent** one (⇒ unfiltered) — a distinction the chart requires.
 * When present the response keeps only `stateSet` / `stateRemoved` entries
 * whose `key` is in the list (`[]` ⇒ none); when absent the response is
 * unfiltered, so the Events list dialog + count badge, which send no filter,
 * stay untouched.
 */
export const SymbolRuleEventsQuerySchema = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
    before: Type.Optional(Type.Number()),
    from: Type.Optional(Type.Number()),
    to: Type.Optional(Type.Number()),
    chartStates: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
