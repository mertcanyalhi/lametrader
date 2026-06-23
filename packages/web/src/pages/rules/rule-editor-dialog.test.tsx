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

let queryClient: QueryClient;

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
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('closes without calling any hook when Cancel is clicked', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const onOpenChange = vi.fn();
    renderEditor(makeRule({ id: 'r-1', name: 'Sample' }), onOpenChange);
    const user = userEvent.setup();

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));

    expect({ onOpenChange: onOpenChange.mock.calls, fetched: fetchSpy.mock.calls.length }).toEqual({
      onOpenChange: [[false]],
      fetched: 0,
    });
  });

  it('PUTs to /rules/:id with the rule input and closes on success in edit mode', async () => {
    const rule = makeRule({ id: 'r-1', name: 'Sample' });
    const fetchSpy = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify(rule), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const onOpenChange = vi.fn();
    renderEditor(rule, onOpenChange);
    const user = userEvent.setup();

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const init = (fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined) ?? {};
    expect({ url: fetchSpy.mock.calls[0]?.[0], method: init.method }).toEqual({
      url: '/api/rules/r-1',
      method: 'PUT',
    });
  });

  it('surfaces a 400 response as an inline alert and keeps the dialog open', async () => {
    const rule = makeRule({ id: 'r-1', name: 'Sample' });
    const fetchSpy = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'rule name "Sample" already exists' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const onOpenChange = vi.fn();
    renderEditor(rule, onOpenChange);
    const user = userEvent.setup();

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));

    const alert = await screen.findByRole('alert');
    expect({
      message: alert.textContent,
      stayedOpen: onOpenChange.mock.calls.find((call) => call[0] === false) === undefined,
    }).toEqual({
      message: 'rule name "Sample" already exists',
      stayedOpen: true,
    });
  });
});
