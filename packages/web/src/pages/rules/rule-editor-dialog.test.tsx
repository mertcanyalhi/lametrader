// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  ActionKind,
  ConditionNodeKind,
  type EnrichedSymbol,
  NumericOperator,
  OperandKind,
  Period,
  type Rule,
  RuleScopeKind,
  StateValueType,
  SymbolType,
  TriggerKind,
} from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RuleEditorDialog } from './rule-editor-dialog';

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

function makeWatched(id: string): EnrichedSymbol {
  return {
    id,
    type: SymbolType.Crypto,
    periods: [Period.OneMinute],
    quote: null,
  } as EnrichedSymbol;
}

let queryClient: QueryClient;
let fetchSpy: ReturnType<typeof vi.fn>;
let watched: EnrichedSymbol[];

function installFetch(): void {
  fetchSpy = vi.fn(async (url: string, init?: RequestInit) => baseHandler(url, init));
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
}

/** Shared base — returns the seed watchlist for `/api/symbols`, an empty list
 * for `/api/profiles` (the operand picker reads attached indicators from
 * profiles), and 404s anything else. Per-test `mockImplementation` overrides
 * fall through to this for the calls they don't care about. */
async function baseHandler(url: string, init?: RequestInit): Promise<Response> {
  const method = init?.method ?? 'GET';
  if (method === 'GET' && String(url).startsWith('/api/symbols')) {
    return new Response(JSON.stringify(watched), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (method === 'GET' && String(url).startsWith('/api/profiles')) {
    return new Response('[]', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  throw new Error(`unexpected fetch: ${method} ${url}`);
}

function renderEditor(rule: Rule | undefined, onOpenChange = vi.fn()): void {
  render(
    <QueryClientProvider client={queryClient}>
      <Theme>
        <RuleEditorDialog open={true} onOpenChange={onOpenChange} mode="edit" initial={rule} />
      </Theme>
    </QueryClientProvider>,
  );
}

describe('RuleEditorDialog', () => {
  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    watched = [makeWatched('crypto:BTCUSDT'), makeWatched('crypto:ETHUSDT')];
    installFetch();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('closes without calling any save hook when Cancel is clicked', async () => {
    const onOpenChange = vi.fn();
    renderEditor(makeRule({ id: 'r-1', name: 'Sample' }), onOpenChange);
    const user = userEvent.setup();

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));

    expect({
      onOpenChange: onOpenChange.mock.calls,
      saveCalls: fetchSpy.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method),
    }).toEqual({
      onOpenChange: [[false]],
      saveCalls: [],
    });
  });

  it('PUTs to /rules/:id with the merged form values and closes on save success', async () => {
    const rule = makeRule({ id: 'r-1', name: 'Sample', description: 'old' });
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'PUT') {
        return new Response(JSON.stringify(rule), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return baseHandler(url, init);
    });
    const onOpenChange = vi.fn();
    renderEditor(rule, onOpenChange);
    const user = userEvent.setup();

    const nameField = screen.getByRole('textbox', { name: 'Name' });
    await user.clear(nameField);
    await user.type(nameField, 'Renamed');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const put = fetchSpy.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'PUT',
    );
    const body = JSON.parse(String((put?.[1] as RequestInit).body));
    expect({ url: put?.[0], name: body.name, scope: body.scope }).toEqual({
      url: '/api/rules/r-1',
      name: 'Renamed',
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'crypto:BTCUSDT' },
    });
  });

  it('renders an inline "Name is required." and skips the save when the name is cleared', async () => {
    const rule = makeRule({ id: 'r-1', name: 'Sample' });
    const onOpenChange = vi.fn();
    renderEditor(rule, onOpenChange);
    const user = userEvent.setup();

    await user.clear(screen.getByRole('textbox', { name: 'Name' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));

    const alerts = await screen.findAllByRole('alert');
    expect({
      messages: alerts.map((alert) => alert.textContent),
      putCount: fetchSpy.mock.calls.filter(
        (call) => (call[1] as RequestInit | undefined)?.method === 'PUT',
      ).length,
    }).toEqual({
      messages: ['Name is required.'],
      putCount: 0,
    });
  });

  it('hides the symbol picker and saves an all-symbols scope when "All symbols" is selected', async () => {
    const rule = makeRule({
      id: 'r-1',
      name: 'Sample',
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'crypto:BTCUSDT' },
    });
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'PUT') {
        return new Response(JSON.stringify(rule), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return baseHandler(url, init);
    });
    renderEditor(rule);
    const user = userEvent.setup();

    await user.click(screen.getByRole('radio', { name: 'All symbols' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));

    const put = await waitFor(() => {
      const call = fetchSpy.mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === 'PUT',
      );
      if (!call) throw new Error('no PUT yet');
      return call;
    });
    const body = JSON.parse(String((put[1] as RequestInit).body));
    expect({
      scope: body.scope,
      pickerVisible: screen.queryByRole('combobox', { name: 'Symbol' }) !== null,
    }).toEqual({
      scope: { kind: RuleScopeKind.AllSymbols },
      pickerVisible: false,
    });
  });

  it('blocks save when the rule has no actions', async () => {
    const rule = makeRule({ id: 'r-1', name: 'Sample', actions: [] as never[] });
    renderEditor(rule);
    const user = userEvent.setup();

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));

    const alerts = await screen.findAllByRole('alert');
    expect({
      hasMessage: alerts.some(
        (alert) => alert.textContent === 'Actions require at least one entry.',
      ),
      putCount: fetchSpy.mock.calls.filter(
        (call) => (call[1] as RequestInit | undefined)?.method === 'PUT',
      ).length,
    }).toEqual({
      hasMessage: true,
      putCount: 0,
    });
  });

  it('blocks save when "On date" expiration is in the past', async () => {
    const rule = makeRule({ id: 'r-1', name: 'Sample' });
    renderEditor(rule);
    const user = userEvent.setup();

    await user.click(screen.getByRole('radio', { name: 'On date' }));
    const dateField = screen.getByLabelText('Expiration date');
    await user.clear(dateField);
    await user.type(dateField, '2000-01-01T12:00');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));

    const alerts = await screen.findAllByRole('alert');
    expect({
      messages: alerts.map((alert) => alert.textContent),
      putCount: fetchSpy.mock.calls.filter(
        (call) => (call[1] as RequestInit | undefined)?.method === 'PUT',
      ).length,
    }).toEqual({
      messages: ['Expiration date must be in the future.'],
      putCount: 0,
    });
  });

  it('blocks save with a "Trigger period is required." inline error when bar-based trigger has no period', async () => {
    const rule = makeRule({
      id: 'r-1',
      name: 'Sample',
      trigger: { kind: TriggerKind.Once },
    });
    renderEditor(rule);
    const user = userEvent.setup();

    await user.click(screen.getByRole('radio', { name: 'Once per bar' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));

    const alerts = await screen.findAllByRole('alert');
    expect({
      messages: alerts.map((alert) => alert.textContent),
      putCount: fetchSpy.mock.calls.filter(
        (call) => (call[1] as RequestInit | undefined)?.method === 'PUT',
      ).length,
    }).toEqual({
      messages: ['Trigger period is required.'],
      putCount: 0,
    });
  });

  it('blocks save with an inline error when the condition has an empty group', async () => {
    const rule = makeRule({
      id: 'r-1',
      name: 'Sample',
      condition: { kind: ConditionNodeKind.And, children: [] },
    });
    const onOpenChange = vi.fn();
    renderEditor(rule, onOpenChange);
    const user = userEvent.setup();

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));

    const message = await screen.findByText('Every AND / OR group must have at least one child.');
    expect({
      shown: message.textContent,
      saveCalls: fetchSpy.mock.calls.filter(
        (call) => (call[1] as RequestInit | undefined)?.method === 'PUT',
      ).length,
      stayedOpen: onOpenChange.mock.calls.find((call) => call[0] === false) === undefined,
    }).toEqual({
      shown: 'Every AND / OR group must have at least one child.',
      saveCalls: 0,
      stayedOpen: true,
    });
  });

  it('surfaces a 400 response as an inline alert and keeps the dialog open', async () => {
    const rule = makeRule({ id: 'r-1', name: 'Sample' });
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'PUT') {
        return new Response(JSON.stringify({ error: 'rule name "Sample" already exists' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return baseHandler(url, init);
    });
    const onOpenChange = vi.fn();
    renderEditor(rule, onOpenChange);
    const user = userEvent.setup();

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));

    const alert = await screen.findByText('rule name "Sample" already exists');
    expect({
      message: alert.textContent,
      stayedOpen: onOpenChange.mock.calls.find((call) => call[0] === false) === undefined,
    }).toEqual({
      message: 'rule name "Sample" already exists',
      stayedOpen: true,
    });
  });
});
