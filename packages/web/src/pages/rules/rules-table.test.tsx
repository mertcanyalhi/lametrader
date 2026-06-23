// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  ActionKind,
  ConditionNodeKind,
  NumericOperator,
  OperandKind,
  Period,
  type Rule,
  RuleEventType,
  RuleScopeKind,
  StateValueType,
  TriggerKind,
} from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RulesTable } from './rules-table';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

const NOW = 1_700_000_000_000;

function makeRule(overrides: Partial<Rule> & Pick<Rule, 'id'>): Rule {
  return {
    profileId: 'p-1',
    name: 'BTC alert',
    order: 1,
    scope: { kind: RuleScopeKind.Symbol, symbolId: 'crypto:BTCUSDT' },
    condition: {
      kind: ConditionNodeKind.Leaf,
      left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
      operator: NumericOperator.Gt,
      right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 0 } },
    },
    trigger: { kind: TriggerKind.Once },
    expiration: null,
    actions: [{ kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'hi' }],
    enabled: true,
    events: [],
    history: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

let queryClient: QueryClient;

function renderTable(rules: Rule[], onEdit: (rule: Rule) => void = vi.fn()): void {
  render(
    <QueryClientProvider client={queryClient}>
      <Theme>
        <RulesTable rules={rules} onEdit={onEdit} />
      </Theme>
    </QueryClientProvider>,
  );
}

/**
 * Return the `<tr>` containing the row-open button with the given accessible
 * name, narrowed to a non-null `HTMLTableRowElement` for `within(...)`.
 */
function rowFor(name: string): HTMLTableRowElement {
  const row = screen.getByRole('button', { name }).closest('tr');
  if (!row) throw new Error(`no row containing "${name}"`);
  return row;
}

describe('RulesTable', () => {
  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the empty-state message when there are no rules', () => {
    renderTable([]);
    expect(screen.getByRole('status')).toHaveTextContent('No rules in this profile yet.');
  });

  it('renders the column headers when rules are present', () => {
    renderTable([makeRule({ id: 'r-1' })]);
    expect({
      order: screen.queryByRole('columnheader', { name: 'Order' }) !== null,
      name: screen.queryByRole('columnheader', { name: 'Name' }) !== null,
      scope: screen.queryByRole('columnheader', { name: 'Scope' }) !== null,
      trigger: screen.queryByRole('columnheader', { name: 'Trigger' }) !== null,
      lastFired: screen.queryByRole('columnheader', { name: 'Last fired' }) !== null,
      actions: screen.queryByRole('columnheader', { name: 'Actions' }) !== null,
    }).toEqual({
      order: true,
      name: true,
      scope: true,
      trigger: true,
      lastFired: true,
      actions: true,
    });
  });

  it('renders one body row per rule with the order, name, symbol-scope, trigger, and never-fired cells', () => {
    renderTable([
      makeRule({
        id: 'r-1',
        order: 2,
        name: 'Above 70k',
        scope: { kind: RuleScopeKind.Symbol, symbolId: 'crypto:BTCUSDT' },
        trigger: { kind: TriggerKind.OncePerBar, period: Period.FifteenMinutes },
      }),
    ]);

    const row = within(rowFor('Open Above 70k'));
    expect({
      order: row.getByRole('cell', { name: '2' }) !== null,
      name: row.getByRole('button', { name: 'Open Above 70k' }) !== null,
      scope: row.queryByText('crypto:BTCUSDT') !== null,
      trigger: row.queryByText('Once per bar (15m)') !== null,
      lastFired: row.queryByText('Never') !== null,
    }).toEqual({
      order: true,
      name: true,
      scope: true,
      trigger: true,
      lastFired: true,
    });
  });

  it('renders "All symbols" in the scope column when the rule targets every symbol', () => {
    renderTable([
      makeRule({ id: 'r-1', name: 'Global', scope: { kind: RuleScopeKind.AllSymbols } }),
    ]);
    const row = within(rowFor('Open Global'));
    expect(row.queryByText('All symbols')).not.toBeNull();
  });

  it('formats the last-fired column from the most recent Fired event', () => {
    renderTable([
      makeRule({
        id: 'r-1',
        name: 'BTC alert',
        events: [
          { type: RuleEventType.Fired, ts: 1_700_000_000_000, ruleId: 'r-1', symbolId: 's-1' },
          { type: RuleEventType.Fired, ts: 1_700_000_120_000, ruleId: 'r-1', symbolId: 's-1' },
          {
            type: RuleEventType.StateSet,
            ts: 1_700_000_300_000,
            ruleId: 'r-1',
            symbolId: 's-1',
            scope: 'symbol' as never,
            key: 'k',
            value: { type: StateValueType.Number, value: 1 },
          },
        ],
      }),
    ]);
    const row = within(rowFor('Open BTC alert'));
    expect(row.queryByText('2023-11-14 22:15')).not.toBeNull();
  });

  it('invokes onEdit with the rule when the row body is clicked', async () => {
    const onEdit = vi.fn();
    const rule = makeRule({ id: 'r-1', name: 'Click me' });
    renderTable([rule], onEdit);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Open Click me' }));

    expect(onEdit.mock.calls).toEqual([[rule]]);
  });

  it('invokes onEdit with the rule when the Edit icon button is clicked', async () => {
    const onEdit = vi.fn();
    const rule = makeRule({ id: 'r-1', name: 'Click me' });
    renderTable([rule], onEdit);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Edit Click me' }));

    expect(onEdit.mock.calls).toEqual([[rule]]);
  });

  it('renders the rows in the order the API returned them, even when out of numerical order', () => {
    renderTable([
      makeRule({ id: 'r-1', name: 'Second', order: 5 }),
      makeRule({ id: 'r-2', name: 'First', order: 1 }),
    ]);
    const names = screen
      .getAllByRole('button', { name: /^Open / })
      .map((button) => button.textContent);
    expect(names).toEqual(['Second', 'First']);
  });

  it('sends PATCH /rules/:id { enabled: false } when the enable switch is toggled off', async () => {
    const rule = makeRule({ id: 'r-1', name: 'Live alert', enabled: true });
    const fetchSpy = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ ...rule, enabled: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    renderTable([rule]);
    const user = userEvent.setup();

    await user.click(screen.getByRole('switch', { name: 'Enable Live alert' }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const init = (fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined) ?? {};
    expect({ url: fetchSpy.mock.calls[0]?.[0], method: init.method, body: init.body }).toEqual({
      url: '/api/rules/r-1',
      method: 'PATCH',
      body: JSON.stringify({ enabled: false }),
    });
  });
});
