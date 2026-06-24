// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  ActionKind,
  ConditionNodeKind,
  NumericOperator,
  OperandKind,
  type Profile,
  ProfileScope,
  type Rule,
  RuleScopeKind,
  StateValueType,
  TriggerKind,
} from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setStoredProfileId } from '../../lib/selected-profile.js';
import { SelectedProfileProvider } from '../../lib/selected-profile-context.js';
import { RulesPage } from './rules-page';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

const NOW = 1_700_000_000_000;

const SCALPER: Profile = {
  id: 'p-1',
  name: 'Scalper',
  description: 'fast moves',
  enabled: true,
  scope: { type: ProfileScope.All },
  createdAt: NOW,
  updatedAt: NOW,
  indicators: [],
};

const SWING: Profile = {
  id: 'p-2',
  name: 'Swing',
  description: 'multi-day',
  enabled: true,
  scope: { type: ProfileScope.All },
  createdAt: NOW,
  updatedAt: NOW,
  indicators: [],
};

function makeRule(overrides: Partial<Rule> & Pick<Rule, 'id'>): Rule {
  return {
    profileId: SCALPER.id,
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

interface FetchCall {
  url: string;
  method: string;
}

interface Matcher {
  match: (url: string, method: string) => boolean;
  respond: () => { status: number; body: unknown };
}

describe('RulesPage', () => {
  let queryClient: QueryClient;
  let calls: FetchCall[];
  let matchers: Matcher[];
  let profiles: Profile[];
  let rules: Rule[];

  beforeEach(() => {
    calls = [];
    matchers = [];
    profiles = [SCALPER, SWING];
    rules = [];
    matchers.push({
      match: (url, method) => method === 'GET' && url.endsWith('/profiles'),
      respond: () => ({ status: 200, body: profiles }),
    });
    matchers.push({
      match: (url, method) => method === 'GET' && url.includes('/rules?profileId='),
      respond: () => ({ status: 200, body: rules }),
    });

    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
      const matcher = matchers.find((m) => m.match(url, method));
      if (!matcher) throw new Error(`unexpected fetch: ${method} ${url}`);
      const { status, body } = matcher.respond();
      return new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  function renderPage(): void {
    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <Theme>
            <SelectedProfileProvider>
              <RulesPage />
            </SelectedProfileProvider>
          </Theme>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  }

  it('renders a "Rules" heading inside the route shell', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Rules' })).toBeInTheDocument();
  });

  it('renders the profile picker dialog trigger in the bottom-bar actions group', async () => {
    profiles = [];
    renderPage();
    const actions = await screen.findByRole('group', { name: 'Rules page actions' });
    expect(within(actions).getByRole('button', { name: 'No profile' })).toBeInTheDocument();
  });

  it('prompts the user to pick a profile when none is selected and no profiles exist', async () => {
    profiles = [];
    renderPage();
    expect(
      await screen.findByText('Pick a profile from the bottom bar to see its rules.'),
    ).toBeInTheDocument();
  });

  it('renders the empty-state message when the selected profile has no rules', async () => {
    rules = [];
    setStoredProfileId(SCALPER.id);
    renderPage();
    expect(await screen.findByText('No rules in this profile yet.')).toBeInTheDocument();
  });

  it('renders the rules table when the selected profile has rules', async () => {
    rules = [makeRule({ id: 'r-1', name: 'BTC alert' })];
    setStoredProfileId(SCALPER.id);
    renderPage();
    expect(await screen.findByRole('button', { name: 'Open BTC alert' })).toBeInTheDocument();
  });

  it('opens the create-mode rule editor when "New rule" is clicked', async () => {
    rules = [];
    setStoredProfileId(SCALPER.id);
    renderPage();
    await screen.findByText('No rules in this profile yet.');
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'New rule' }));

    expect(await screen.findByRole('heading', { name: 'New rule' })).toBeInTheDocument();
  });

  it('switches the rendered rules when the user picks a different profile', async () => {
    rules = [makeRule({ id: 'r-1', name: 'BTC alert' })];
    setStoredProfileId(SCALPER.id);
    renderPage();
    await screen.findByRole('button', { name: 'Open BTC alert' });
    const user = userEvent.setup();

    rules = [];
    await user.click(screen.getByRole('button', { name: SCALPER.name }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: `Select ${SWING.name}` }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('No rules in this profile yet.')).toBeInTheDocument();
  });
});
