// @vitest-environment jsdom
import {
  ActionKind,
  ComparisonOperator,
  ConditionNodeKind,
  LeafConditionFamily,
  NotificationChannel,
  OperandKind,
  type Rule,
  RuleScopeKind,
  StateValueType,
  TriggerKind,
} from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SELECTED_PROFILE_STORAGE_KEY } from '../../lib/selected-profile.js';
import { SelectedProfileProvider } from '../../lib/selected-profile-context.js';
import { SymbolRulesDialog } from './symbol-rules-dialog.js';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));

/** Build a minimal valid {@link Rule} with overrides. */
function ruleWith(overrides: Partial<Rule> & Pick<Rule, 'id'>): Rule {
  return {
    profileId: 'profile-1',
    name: 'Cross 100',
    scope: { kind: RuleScopeKind.Symbol, symbolId: 'crypto:BTCUSDT' },
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

/**
 * Test harness — mounts the dialog inside a fresh QueryClient + Radix Theme +
 * SelectedProfileProvider so the dialog reads the same context the real app
 * would supply.
 */
function Harness({ symbolId = 'crypto:BTCUSDT' }: { symbolId?: string }): ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <Theme>
        <SelectedProfileProvider>
          <SymbolRulesDialog symbolId={symbolId} />
        </SelectedProfileProvider>
      </Theme>
    </QueryClientProvider>
  );
}

describe('SymbolRulesDialog', () => {
  let matchers: Array<{ includes: string; body: () => unknown }>;

  beforeEach(() => {
    matchers = [];
    const fetchSpy = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      if (init?.method === 'PATCH') {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const match = matchers.find((m) => u.includes(m.includes));
      if (!match) throw new Error(`unexpected fetch: ${u}`);
      return new Response(JSON.stringify(match.body()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    window.localStorage.setItem(SELECTED_PROFILE_STORAGE_KEY, 'profile-1');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  function onRequest(includes: string, body: () => unknown): void {
    matchers.push({ includes, body });
  }

  it('renders only its trigger button labeled Rules when closed, with the integer count in a badge', async () => {
    onRequest('/profiles', () => [
      {
        id: 'profile-1',
        name: 'Scalper',
        description: '',
        enabled: true,
        scope: { type: 'All' },
        createdAt: 1,
        updatedAt: 1,
        indicators: [],
      },
    ]);
    onRequest('/rules?', () => [ruleWith({ id: 'r-1' }), ruleWith({ id: 'r-2', name: 'Another' })]);

    render(<Harness />);

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Rules (2)' })).not.toBeNull());
    // The dialog body is gated behind the open state — no table headers visible.
    expect(screen.queryByRole('columnheader', { name: 'Name' })).toEqual(null);
  });

  it('renders the count as 0 when the server returns no rules for the symbol', async () => {
    onRequest('/profiles', () => [
      {
        id: 'profile-1',
        name: 'Scalper',
        description: '',
        enabled: true,
        scope: { type: 'All' },
        createdAt: 1,
        updatedAt: 1,
        indicators: [],
      },
    ]);
    onRequest('/rules?', () => []);

    render(<Harness />);

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Rules (0)' })).not.toBeNull());
  });

  it('opens to a title "Rules for <symbolId>" when the trigger is clicked', async () => {
    onRequest('/profiles', () => [
      {
        id: 'profile-1',
        name: 'Scalper',
        description: '',
        enabled: true,
        scope: { type: 'All' },
        createdAt: 1,
        updatedAt: 1,
        indicators: [],
      },
    ]);
    onRequest('/rules?', () => [ruleWith({ id: 'r-1' })]);

    render(<Harness />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Rules (1)' }));

    expect(screen.getByRole('heading', { name: 'Rules for crypto:BTCUSDT' })).toBeDefined();
  });

  it('renders the RulesTable with the Scope column omitted (implicit single symbol)', async () => {
    onRequest('/profiles', () => [
      {
        id: 'profile-1',
        name: 'Scalper',
        description: '',
        enabled: true,
        scope: { type: 'All' },
        createdAt: 1,
        updatedAt: 1,
        indicators: [],
      },
    ]);
    onRequest('/rules?', () => [ruleWith({ id: 'r-1' })]);

    render(<Harness />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Rules (1)' }));

    // Headers from RulesTable that we DO expect to see.
    await waitFor(() =>
      expect(screen.queryByRole('columnheader', { name: 'Name' })).not.toBeNull(),
    );
    expect(screen.getByRole('columnheader', { name: 'Trigger' })).toBeDefined();
    expect(screen.getByRole('columnheader', { name: 'Last fired' })).toBeDefined();
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeDefined();
    // Scope is implicit on the symbol-scoped modal, so omit it.
    expect(screen.queryByRole('columnheader', { name: 'Scope' })).toEqual(null);
  });

  it('renders one row per rule returned by GET /rules?profileId=<p>&symbolId=<s>', async () => {
    onRequest('/profiles', () => [
      {
        id: 'profile-1',
        name: 'Scalper',
        description: '',
        enabled: true,
        scope: { type: 'All' },
        createdAt: 1,
        updatedAt: 1,
        indicators: [],
      },
    ]);
    onRequest('/rules?', () => [
      ruleWith({ id: 'r-1', name: 'First' }),
      ruleWith({ id: 'r-2', name: 'Second' }),
    ]);

    render(<Harness />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Rules (2)' }));

    await waitFor(() => expect(screen.queryByText('First')).not.toBeNull());
    expect(screen.getByText('Second')).toBeDefined();
  });

  it('renders an empty-state hint when no rules match the symbol filter', async () => {
    onRequest('/profiles', () => [
      {
        id: 'profile-1',
        name: 'Scalper',
        description: '',
        enabled: true,
        scope: { type: 'All' },
        createdAt: 1,
        updatedAt: 1,
        indicators: [],
      },
    ]);
    onRequest('/rules?', () => []);

    render(<Harness />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Rules (0)' }));

    expect(screen.getByText(/no rules yet/i)).toBeDefined();
  });

  it('renders a + New rule button that opens the rule editor in create mode pre-scoped to the symbol', async () => {
    onRequest('/profiles', () => [
      {
        id: 'profile-1',
        name: 'Scalper',
        description: '',
        enabled: true,
        scope: { type: 'All' },
        createdAt: 1,
        updatedAt: 1,
        indicators: [],
      },
    ]);
    onRequest('/rules?', () => []);
    onRequest('/symbols?enrich=true', () => []);
    onRequest('/state', () => ({}));

    render(<Harness />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Rules (0)' }));
    await user.click(await screen.findByRole('button', { name: /new rule/i }));

    // The editor opens with the create-mode title "New rule".
    expect(screen.getByRole('heading', { name: 'New rule' })).toBeDefined();
    // The scope field is pre-populated with the chart's symbol id; the
    // single-symbol picker surfaces it as the text on its accessible "Rule
    // symbol" trigger button.
    const scopePicker = screen.getByRole('button', { name: 'Rule symbol' });
    expect(scopePicker.textContent).toContain('crypto:BTCUSDT');
  });

  it('renders a warning callout pointing to the profile picker when no profile is selected', async () => {
    window.localStorage.removeItem(SELECTED_PROFILE_STORAGE_KEY);
    onRequest('/profiles', () => []);
    // The hook doesn't fire /rules when profileId is null, so don't seed it.

    render(<Harness />);

    const user = userEvent.setup();
    // With no profile, the count is unknown — render `Rules` with no count.
    await user.click(await screen.findByRole('button', { name: 'Rules' }));

    expect(screen.getByText(/select.*profile/i)).toBeDefined();
    // No + New rule button — there's nothing to attach the rule to.
    expect(screen.queryByRole('button', { name: /new rule/i })).toEqual(null);
  });
});
