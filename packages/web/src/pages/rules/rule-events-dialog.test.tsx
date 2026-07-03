// @vitest-environment jsdom
import {
  ComparisonOperator,
  ConditionNodeKind,
  EvaluationTriggerKind,
  LeafConditionFamily,
  OperandKind,
  Period,
  type Rule,
  type RuleEventEntry,
  RuleEventType,
  RuleScopeKind,
  StateValueType,
  TriggerKind,
} from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuleEventsDialog } from './rule-events-dialog';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Mock the events endpoint to return `events` for any GET. */
function mockEvents(events: RuleEventEntry[]): void {
  globalThis.fetch = vi.fn(async () => {
    return new Response(JSON.stringify(events), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

const RULE: Rule = {
  id: 'r-1',
  profileId: 'profile-1',
  name: 'Open > 50000',
  scope: { kind: RuleScopeKind.Symbol, symbolId: 'BTCUSDT' },
  condition: {
    kind: ConditionNodeKind.Leaf,
    leaf: {
      family: LeafConditionFamily.Comparison,
      operator: ComparisonOperator.Gt,
      left: { kind: OperandKind.Open },
      right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 50000 } },
      interval: Period.OneHour,
    },
  },
  trigger: { kind: TriggerKind.OncePerBarClose, period: Period.OneHour },
  expiration: null,
  actions: [],
  enabled: true,
  order: 1,
  createdAt: 0,
  updatedAt: 0,
};

/** Wrap in the providers the dialog reads (React Query + Radix theme). */
function wrapper(): { wrapper: ({ children }: { children: ReactNode }) => ReactNode } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>
        <Theme>{children}</Theme>
      </QueryClientProvider>
    ),
  };
}

type Fired = Extract<RuleEventEntry, { type: RuleEventType.Fired }>;

/** A `Fired` entry driven by the given inbound event. */
function firedEntry(inboundEvent: Fired['context']['inboundEvent']): RuleEventEntry {
  return {
    type: RuleEventType.Fired,
    ts: 3_600_000,
    ruleId: 'r-1',
    symbolId: 'BTCUSDT',
    context: {
      inboundEvent,
      lookupSnapshot: {
        period: Period.OneHour,
        current: null,
        open: 49900,
        high: 50100,
        low: 49800,
        close: 50000,
        volume: 12,
      },
    },
  };
}

describe('RuleEventsDialog', () => {
  it('renders the inbound bar period for a Fired entry driven by a bar-close event', async () => {
    mockEvents([
      firedEntry({
        kind: EvaluationTriggerKind.BarClosed,
        ts: 3_600_000,
        symbolId: 'BTCUSDT',
        period: Period.OneHour,
      }),
    ]);

    render(<RuleEventsDialog rule={RULE} open onOpenChange={() => {}} />, wrapper());

    expect(await screen.findByText('fired on barClosed (1h)')).toBeDefined();
  });

  it('omits the period for a Fired entry driven by a period-less tick event', async () => {
    mockEvents([
      firedEntry({
        kind: EvaluationTriggerKind.Tick,
        ts: 3_600_000,
        symbolId: 'BTCUSDT',
        price: 50010,
      }),
    ]);

    render(<RuleEventsDialog rule={RULE} open onOpenChange={() => {}} />, wrapper());

    expect(await screen.findByText('fired on tick')).toBeDefined();
  });
});
