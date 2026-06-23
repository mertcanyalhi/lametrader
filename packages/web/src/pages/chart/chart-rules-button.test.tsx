// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  ActionKind,
  ConditionNodeKind,
  NumericOperator,
  OperandKind,
  type Rule,
  RuleScopeKind,
  StateValueType,
  TriggerKind,
} from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setStoredProfileId } from '../../lib/selected-profile.js';
import { SelectedProfileProvider } from '../../lib/selected-profile-context.js';
import { ChartRulesButton } from './chart-rules-button';

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
let rules: Rule[];

function installFetch(): void {
  globalThis.fetch = vi.fn(async (url: string) => {
    if (String(url).startsWith('/api/rules?')) {
      return new Response(JSON.stringify(rules), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('[]', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

function renderButton(): void {
  render(
    <QueryClientProvider client={queryClient}>
      <Theme>
        <SelectedProfileProvider>
          <ChartRulesButton symbolId="crypto:BTCUSDT" />
        </SelectedProfileProvider>
      </Theme>
    </QueryClientProvider>,
  );
}

describe('ChartRulesButton', () => {
  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rules = [];
    installFetch();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('labels the trigger "Rules" and disables it when no profile is selected', () => {
    renderButton();
    const trigger = screen.getByRole('button', { name: 'Rules' });
    expect(trigger).toBeDisabled();
  });

  it('labels the trigger with the live count when a profile is selected', async () => {
    setStoredProfileId('p-1');
    rules = [makeRule({ id: 'r-1' }), makeRule({ id: 'r-2' })];
    renderButton();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Rules 2' })).not.toBeNull());
  });

  it('opens a dialog with the filtered rules table on click', async () => {
    setStoredProfileId('p-1');
    rules = [makeRule({ id: 'r-1', name: 'BTC alert' })];
    renderButton();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Rules 1' }));
    const dialog = await screen.findByRole('dialog', { name: /Rules for crypto:BTCUSDT/ });

    expect(within(dialog).getByRole('button', { name: 'Open BTC alert' })).toBeInTheDocument();
  });

  it('opens the editor in create mode when "New rule" is clicked', async () => {
    setStoredProfileId('p-1');
    renderButton();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Rules 0' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: /Rules for crypto:BTCUSDT/ })).getByRole(
        'button',
        { name: 'New rule' },
      ),
    );

    expect(await screen.findByRole('dialog', { name: 'New rule' })).toBeInTheDocument();
  });
});
