// @vitest-environment jsdom
import {
  ActionKind,
  ComparisonOperator,
  ConditionNodeKind,
  LeafConditionFamily,
  NotificationChannel,
  OperandKind,
  Period,
  type Rule,
  RuleScopeKind,
  StateValueType,
  TriggerKind,
} from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatTrigger, RulesTable } from './rules-table';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  // Patch/delete mutations the row drives — return the rule body so React
  // Query treats success as the new server state.
  globalThis.fetch = vi.fn(async (_input, init) => {
    if (init?.method === 'DELETE') {
      return new Response(null, { status: 204 });
    }
    if (init?.method === 'PATCH') {
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('[]', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
});

/**
 * Build a minimal valid {@link Rule} with overrides — keeps tests focused on
 * the column they assert rather than ceremony.
 */
function ruleWith(overrides: Partial<Rule> & Pick<Rule, 'id'>): Rule {
  return {
    profileId: 'profile-1',
    name: 'My rule',
    scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
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
        kind: ActionKind.Notification,
        channel: NotificationChannel.Telegram,
        destinationName: 'main',
        template: 'fired',
      },
    ],
    enabled: true,
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function Harness({
  rules,
  columns,
  onEdit = () => {},
  onEvents = () => {},
}: {
  rules: Rule[];
  columns?: import('./rules-table').RulesTableColumns;
  onEdit?: (rule: Rule) => void;
  onEvents?: (rule: Rule) => void;
}): ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <Theme>
        <RulesTable rules={rules} columns={columns} onEdit={onEdit} onEvents={onEvents} />
      </Theme>
    </QueryClientProvider>
  );
}

describe('formatTrigger', () => {
  it('returns "Every time" for an EveryTime trigger', () => {
    expect(formatTrigger({ kind: TriggerKind.EveryTime })).toEqual('Every time');
  });

  it('returns "Once per bar (1m)" for a OncePerBar 1-minute trigger', () => {
    expect(formatTrigger({ kind: TriggerKind.OncePerBar, period: Period.OneMinute })).toEqual(
      'Once per bar (1m)',
    );
  });

  it('returns "Once per interval (60000ms)" for a 60 s wall-clock trigger', () => {
    expect(formatTrigger({ kind: TriggerKind.OncePerInterval, intervalMs: 60_000 })).toEqual(
      'Once per interval (60000ms)',
    );
  });
});

describe('RulesTable headers', () => {
  it('renders every column header in the default config', () => {
    render(<Harness rules={[]} />);
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeDefined();
    expect(screen.getByRole('columnheader', { name: 'Scope' })).toBeDefined();
    expect(screen.getByRole('columnheader', { name: 'Trigger' })).toBeDefined();
    expect(screen.getByRole('columnheader', { name: 'Last fired' })).toBeDefined();
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeDefined();
  });

  it('omits the Scope header when columns.scope is false', () => {
    render(<Harness rules={[]} columns={{ scope: false }} />);
    expect(screen.queryByRole('columnheader', { name: 'Scope' })).toEqual(null);
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeDefined();
  });
});

describe('RulesTable Name + Active/Inactive badge', () => {
  it('shows Active for an enabled rule', () => {
    render(<Harness rules={[ruleWith({ id: 'r1', enabled: true })]} />);
    const cells = screen.getAllByRole('cell');
    const nameCell = cells.find((cell) => cell.textContent?.includes('My rule'));
    expect(nameCell?.textContent).toContain('Active');
    expect(nameCell?.textContent).not.toContain('Inactive');
  });

  it('shows Inactive for a disabled rule', () => {
    render(<Harness rules={[ruleWith({ id: 'r1', enabled: false })]} />);
    const cells = screen.getAllByRole('cell');
    const nameCell = cells.find((cell) => cell.textContent?.includes('My rule'));
    expect(nameCell?.textContent).toContain('Inactive');
  });
});

describe('RulesTable Scope cell', () => {
  it('reads "Single <symbol>" for a Symbol-scoped rule', () => {
    render(
      <Harness
        rules={[
          ruleWith({
            id: 'r1',
            scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
          }),
        ]}
      />,
    );
    const cells = screen.getAllByRole('cell');
    const scopeCell = cells.find((cell) => cell.textContent === 'Single AAPL');
    expect(scopeCell).toBeDefined();
  });

  it('reads "Multiple <count>" for a Symbols-list-scoped rule', () => {
    render(
      <Harness
        rules={[
          ruleWith({
            id: 'r1',
            scope: { kind: RuleScopeKind.Symbols, symbolIds: ['AAPL', 'MSFT', 'GOOG'] },
          }),
        ]}
      />,
    );
    const cells = screen.getAllByRole('cell');
    const scopeCell = cells.find((cell) => cell.textContent === 'Multiple 3');
    expect(scopeCell).toBeDefined();
  });

  it('reads "All" for an AllSymbols-scoped rule', () => {
    render(
      <Harness
        rules={[
          ruleWith({
            id: 'r1',
            scope: { kind: RuleScopeKind.AllSymbols },
          }),
        ]}
      />,
    );
    const cells = screen.getAllByRole('cell');
    const scopeCell = cells.find((cell) => cell.textContent === 'All');
    expect(scopeCell).toBeDefined();
  });
});

describe('RulesTable Last fired cell', () => {
  it('reads "Never" when lastFiredAt is undefined', () => {
    render(<Harness rules={[ruleWith({ id: 'r1' })]} />);
    expect(screen.getByText('Never')).toBeDefined();
  });

  it('renders the formatted timestamp when lastFiredAt is set', () => {
    // 2026-06-29T17:54:14.000Z — the issue's createdAt for a sanity-check value.
    const lastFiredAt = Date.UTC(2026, 5, 29, 17, 54, 14, 0);
    render(<Harness rules={[ruleWith({ id: 'r1', lastFiredAt })]} />);
    expect(screen.getByText('2026-06-29 17:54:14.000')).toBeDefined();
  });
});

describe('RulesTable play/pause toggle', () => {
  it('PATCHes /rules/:id with enabled flipped when the toggle is clicked', async () => {
    const user = userEvent.setup();
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    render(<Harness rules={[ruleWith({ id: 'r1', name: 'Cross above', enabled: true })]} />);
    const toggle = screen.getByRole('switch', { name: 'Disable Cross above' });
    await user.click(toggle);
    const patchCall = fetchMock.mock.calls.find((call) => {
      const init = call[1] as RequestInit | undefined;
      return init?.method === 'PATCH';
    });
    expect(patchCall).toBeDefined();
    expect(patchCall?.[0]).toEqual('/api/rules/r1');
    expect(JSON.parse(patchCall?.[1].body as string)).toEqual({ enabled: false });
  });
});

describe('RulesTable Actions column', () => {
  it('invokes onEdit when the Edit icon is clicked', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const rule = ruleWith({ id: 'r1', name: 'EditMe' });
    render(<Harness rules={[rule]} onEdit={onEdit} />);
    await user.click(screen.getByRole('button', { name: 'Edit EditMe' }));
    expect(onEdit.mock.calls).toEqual([[rule]]);
  });

  it('invokes onEvents when the Events icon is clicked', async () => {
    const user = userEvent.setup();
    const onEvents = vi.fn();
    const rule = ruleWith({ id: 'r1', name: 'EventsMe' });
    render(<Harness rules={[rule]} onEvents={onEvents} />);
    await user.click(screen.getByRole('button', { name: 'Events for EventsMe' }));
    expect(onEvents.mock.calls).toEqual([[rule]]);
  });

  it('DELETEs /rules/:id after the user confirms the alert dialog', async () => {
    const user = userEvent.setup();
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    render(<Harness rules={[ruleWith({ id: 'r1', name: 'Doomed' })]} />);
    await user.click(screen.getByRole('button', { name: 'Delete Doomed' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const deleteCall = fetchMock.mock.calls.find((call) => {
      const init = call[1] as RequestInit | undefined;
      return init?.method === 'DELETE';
    });
    expect(deleteCall).toBeDefined();
    expect(deleteCall?.[0]).toEqual('/api/rules/r1');
  });

  it('does NOT DELETE when the user cancels the alert dialog', async () => {
    const user = userEvent.setup();
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    render(<Harness rules={[ruleWith({ id: 'r1', name: 'Survivor' })]} />);
    await user.click(screen.getByRole('button', { name: 'Delete Survivor' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    const deleteCall = fetchMock.mock.calls.find((call) => {
      const init = call[1] as RequestInit | undefined;
      return init?.method === 'DELETE';
    });
    expect(deleteCall).toBeUndefined();
  });
});
