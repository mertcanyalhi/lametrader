// @vitest-environment jsdom
import {
  ActionKind,
  ComparisonOperator,
  ConditionNodeKind,
  EvaluationTriggerKind,
  LeafConditionFamily,
  OperandKind,
  type Rule,
  type RuleEventEntry,
  RuleEventType,
  RuleScopeKind,
  StateScope,
  StateValueType,
  TriggerKind,
} from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SymbolRuleEventsDialog } from './symbol-rule-events-dialog.js';

const SYMBOL = 'crypto:BTCUSDT';

/**
 * Build a `Rule` with the given id + name. The actual fields don't matter
 * for these tests — only the `id` → `name` lookup the table uses.
 */
function rule(id: string, name: string): Rule {
  return {
    id,
    profileId: 'p1',
    name,
    scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL },
    condition: {
      kind: ConditionNodeKind.Leaf,
      leaf: {
        family: LeafConditionFamily.Comparison,
        operator: ComparisonOperator.Gt,
        left: { kind: OperandKind.Price },
        right: {
          kind: OperandKind.Literal,
          value: { type: StateValueType.Number, value: 100 },
        },
      },
    },
    trigger: { kind: TriggerKind.EveryTime },
    expiration: null,
    actions: [
      {
        kind: ActionKind.SetSymbolState,
        key: 'fired',
        value: { type: StateValueType.Bool, value: true },
      },
    ],
    enabled: true,
    order: 1,
    createdAt: 0,
    updatedAt: 0,
  };
}

/** Build a minimal `Fired` event entry at the given source + persistence stamps. */
function firedEntry({
  ts,
  firedAt,
  ruleId = 'r1',
}: {
  ts: number;
  firedAt: number;
  ruleId?: string;
}): RuleEventEntry {
  return {
    type: RuleEventType.Fired,
    ts,
    firedAt,
    ruleId,
    symbolId: SYMBOL,
    context: {
      inboundEvent: {
        kind: EvaluationTriggerKind.Tick,
        ts,
        symbolId: SYMBOL,
        price: 101,
      },
      lookupSnapshot: {
        current: 101,
        open: null,
        high: null,
        low: null,
        close: null,
        volume: null,
      },
    },
  };
}

interface Matcher {
  /** Path-substring the matcher matches against the request URL. */
  includes: string;
  /** Optional method gate (default GET). */
  method?: string;
  /** Response body builder. */
  body: () => unknown;
}

function makeWrapper(): { wrapper: (props: { children: ReactNode }) => ReactNode } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
    <QueryClientProvider client={client}>
      <Theme>{children}</Theme>
    </QueryClientProvider>
  );
  return { wrapper };
}

describe('SymbolRuleEventsDialog', () => {
  let matchers: Matcher[];

  beforeEach(() => {
    matchers = [];
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const match = matchers.find(
        (m) => (m.method ?? 'GET') === method && String(url).includes(m.includes),
      );
      if (!match) throw new Error(`unexpected fetch: ${method} ${url}`);
      return new Response(JSON.stringify(match.body()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the trigger button labeled with the raw count when count is small', async () => {
    matchers.push({ includes: '/rule-events/count', body: () => ({ count: 7 }) });
    const { wrapper } = makeWrapper();
    render(<SymbolRuleEventsDialog symbolId={SYMBOL} />, { wrapper });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Events (7)' })).not.toBeNull(),
    );
  });

  it('caps the trigger badge at 99+ when the count exceeds 99', async () => {
    matchers.push({ includes: '/rule-events/count', body: () => ({ count: 250 }) });
    const { wrapper } = makeWrapper();
    render(<SymbolRuleEventsDialog symbolId={SYMBOL} />, { wrapper });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Events (99+)' })).not.toBeNull(),
    );
  });

  it('renders the trigger badge as 0 when the symbol has no events', async () => {
    matchers.push({ includes: '/rule-events/count', body: () => ({ count: 0 }) });
    const { wrapper } = makeWrapper();
    render(<SymbolRuleEventsDialog symbolId={SYMBOL} />, { wrapper });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Events (0)' })).not.toBeNull(),
    );
  });

  it('opens the dialog with the title "Rule events for <symbolId>" and the five-column table', async () => {
    matchers.push({ includes: '/rule-events/count', body: () => ({ count: 1 }) });
    matchers.push({
      includes: `/symbols/${encodeURIComponent(SYMBOL)}/rule-events?`,
      body: () => [firedEntry({ ts: 1_700_000_001_000, firedAt: 1_700_000_001_500 })],
    });
    matchers.push({ includes: '/rules', body: () => [rule('r1', 'price up')] });
    const user = userEvent.setup();
    const { wrapper } = makeWrapper();
    render(<SymbolRuleEventsDialog symbolId={SYMBOL} />, { wrapper });
    await user.click(await screen.findByRole('button', { name: 'Events (1)' }));
    expect(
      await screen.findByRole('heading', { name: `Rule events ${SYMBOL}` }),
    ).toBeInTheDocument();
    expect(
      ['Source at', 'Fired at', 'Rule', 'Type', 'Detail'].map(
        (header) => within(screen.getByRole('table')).queryAllByText(header).length > 0,
      ),
    ).toEqual([true, true, true, true, true]);
  });

  it('renders 15 rows per page by default and exposes a page count', async () => {
    matchers.push({ includes: '/rule-events/count', body: () => ({ count: 18 }) });
    const eighteen = Array.from({ length: 18 }, (_, index) =>
      firedEntry({ ts: 1_000_000 + index, firedAt: 1_000_100 + index }),
    );
    matchers.push({
      includes: `/symbols/${encodeURIComponent(SYMBOL)}/rule-events?`,
      body: () => eighteen,
    });
    matchers.push({ includes: '/rules', body: () => [rule('r1', 'price up')] });
    const user = userEvent.setup();
    const { wrapper } = makeWrapper();
    render(<SymbolRuleEventsDialog symbolId={SYMBOL} />, { wrapper });
    await user.click(await screen.findByRole('button', { name: 'Events (18)' }));
    await screen.findByText('Page 1 of 2');
    const tbody = within(screen.getByRole('table')).getAllByRole('row');
    // 1 header row + 15 data rows
    expect(tbody.length).toEqual(16);
  });

  it('toggles the sort to firedAt when the Fired at header is clicked', async () => {
    matchers.push({ includes: '/rule-events/count', body: () => ({ count: 2 }) });
    matchers.push({
      includes: `/symbols/${encodeURIComponent(SYMBOL)}/rule-events?`,
      body: () => [
        firedEntry({ ts: 2_000, firedAt: 1_000, ruleId: 'r1' }),
        firedEntry({ ts: 1_000, firedAt: 2_000, ruleId: 'r2' }),
      ],
    });
    matchers.push({
      includes: '/rules',
      body: () => [rule('r1', 'older firedAt'), rule('r2', 'newer firedAt')],
    });
    const user = userEvent.setup();
    const { wrapper } = makeWrapper();
    render(<SymbolRuleEventsDialog symbolId={SYMBOL} />, { wrapper });
    await user.click(await screen.findByRole('button', { name: 'Events (2)' }));
    await screen.findByText('newer firedAt');
    // Default sort is firedAt desc — newer firedAt (2_000) comes first.
    const initialRows = within(screen.getByRole('table')).getAllByRole('row');
    const firstDataRow = initialRows[1];
    expect(firstDataRow).toBeDefined();
    if (!firstDataRow) throw new Error('expected at least one data row');
    expect(within(firstDataRow).queryByText('newer firedAt')).not.toBeNull();
    // Click "Fired at" → flips to firedAt asc — older firedAt (1_000) comes first.
    await user.click(screen.getByRole('button', { name: 'Sort by Fired at' }));
    await waitFor(() => {
      const rows = within(screen.getByRole('table')).getAllByRole('row');
      const first = rows[1];
      if (!first) throw new Error('expected data row');
      expect(within(first).queryByText('older firedAt')).not.toBeNull();
    });
  });

  it('toggles the sort axis to ts when the Source at header is clicked', async () => {
    matchers.push({ includes: '/rule-events/count', body: () => ({ count: 2 }) });
    matchers.push({
      includes: `/symbols/${encodeURIComponent(SYMBOL)}/rule-events?`,
      body: () => [
        firedEntry({ ts: 2_000, firedAt: 1_000, ruleId: 'r1' }),
        firedEntry({ ts: 1_000, firedAt: 2_000, ruleId: 'r2' }),
      ],
    });
    matchers.push({
      includes: '/rules',
      body: () => [rule('r1', 'newer ts'), rule('r2', 'older ts')],
    });
    const user = userEvent.setup();
    const { wrapper } = makeWrapper();
    render(<SymbolRuleEventsDialog symbolId={SYMBOL} />, { wrapper });
    await user.click(await screen.findByRole('button', { name: 'Events (2)' }));
    await screen.findByText('newer ts');
    // Click "Source at" → sort axis ts desc — newer ts (2_000) comes first.
    await user.click(screen.getByRole('button', { name: 'Sort by Source at' }));
    await waitFor(() => {
      const rows = within(screen.getByRole('table')).getAllByRole('row');
      const first = rows[1];
      if (!first) throw new Error('expected data row');
      expect(within(first).queryByText('newer ts')).not.toBeNull();
    });
  });

  it('renders variant-specific Detail content for each event type', async () => {
    matchers.push({ includes: '/rule-events/count', body: () => ({ count: 4 }) });
    matchers.push({
      includes: `/symbols/${encodeURIComponent(SYMBOL)}/rule-events?`,
      body: (): RuleEventEntry[] => [
        {
          type: RuleEventType.StateSet,
          ts: 4_000,
          firedAt: 4_000,
          ruleId: 'r1',
          symbolId: SYMBOL,
          scope: StateScope.Symbol,
          key: 'fired',
          value: { type: StateValueType.Bool, value: true },
        },
        {
          type: RuleEventType.NotificationSent,
          ts: 3_000,
          firedAt: 3_000,
          ruleId: 'r1',
          symbolId: SYMBOL,
          destinationName: 'main',
          body: 'price up',
        },
        {
          type: RuleEventType.Error,
          ts: 2_000,
          firedAt: 2_000,
          ruleId: 'r1',
          symbolId: SYMBOL,
          reason: 'transport failure',
        },
        {
          type: RuleEventType.CycleOverflow,
          ts: 1_000,
          firedAt: 1_000,
          ruleId: 'r1',
          symbolId: SYMBOL,
          cycleLimit: 8,
        },
      ],
    });
    matchers.push({ includes: '/rules', body: () => [rule('r1', 'price up')] });
    const user = userEvent.setup();
    const { wrapper } = makeWrapper();
    render(<SymbolRuleEventsDialog symbolId={SYMBOL} />, { wrapper });
    await user.click(await screen.findByRole('button', { name: 'Events (4)' }));
    expect(await screen.findByText('fired = true')).toBeInTheDocument();
    expect(screen.queryByText('main: price up')).not.toBeNull();
    expect(screen.queryByText('transport failure')).not.toBeNull();
    expect(screen.queryByText('cycle limit: 8')).not.toBeNull();
  });
});
