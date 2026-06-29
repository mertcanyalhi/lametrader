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
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type RuleInput,
  useCreateRule,
  useDeleteRule,
  usePatchRule,
  useRule,
  useRuleEvents,
  useRules,
  useSymbolRuleEvents,
  useSymbolRuleEventsCount,
} from './rules';

/** A minimal `RuleInput` shape — the server re-validates against the v2 schema. */
function ruleInput(): RuleInput {
  return {
    profileId: 'p1',
    name: 'r',
    order: 1,
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
    trigger: { kind: TriggerKind.Once },
    expiration: null,
    actions: [
      {
        kind: ActionKind.Notification,
        channel: NotificationChannel.Telegram,
        destinationName: 'main',
        template: 'hi',
      },
    ],
    enabled: true,
  };
}

/** A skeleton {@link Rule} the fake API can echo back to the client. */
function ruleResponse(id: string): Rule {
  return {
    ...ruleInput(),
    id,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('rules hooks', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function makeWrapper(): {
    wrapper: (props: { children: ReactNode }) => ReactNode;
  } {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return { wrapper };
  }

  it('useRules issues GET /api/rules and returns the list', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([ruleResponse('r1')]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useRules(), { wrapper });
    await waitFor(() => {
      expect(result.current.data?.map((r) => r.id)).toEqual(['r1']);
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toEqual('/api/rules');
  });

  it('useRules threads profileId / symbolId / enabled into the query string', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const { wrapper } = makeWrapper();
    renderHook(() => useRules({ profileId: 'p1', symbolId: 'crypto:BTCUSDT', enabled: true }), {
      wrapper,
    });
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toEqual(
      '/api/rules?profileId=p1&symbolId=crypto%3ABTCUSDT&enabled=true',
    );
  });

  it('useRule issues GET /api/rules/:id', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(ruleResponse('r1')), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useRule('r1'), { wrapper });
    await waitFor(() => {
      expect(result.current.data?.id).toEqual('r1');
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toEqual('/api/rules/r1');
  });

  it('useCreateRule POSTs to /api/rules with the input body', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(ruleResponse('r1')), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useCreateRule(), { wrapper });
    const input = ruleInput();
    await act(async () => {
      await result.current.mutateAsync(input);
    });
    const init = (fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined) ?? {};
    expect({
      url: fetchSpy.mock.calls[0]?.[0],
      method: init.method,
      body: init.body,
    }).toEqual({ url: '/api/rules', method: 'POST', body: JSON.stringify(input) });
  });

  it('usePatchRule PATCHes /api/rules/:id with the partial body', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(ruleResponse('r1')), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => usePatchRule(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 'r1', patch: { enabled: false } });
    });
    const init = (fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined) ?? {};
    expect({
      url: fetchSpy.mock.calls[0]?.[0],
      method: init.method,
      body: init.body,
    }).toEqual({
      url: '/api/rules/r1',
      method: 'PATCH',
      body: JSON.stringify({ enabled: false }),
    });
  });

  it('useDeleteRule DELETEs /api/rules/:id and returns undefined on 204', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useDeleteRule(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync('r1');
    });
    const init = (fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined) ?? {};
    expect({ url: fetchSpy.mock.calls[0]?.[0], method: init.method }).toEqual({
      url: '/api/rules/r1',
      method: 'DELETE',
    });
  });

  it('useRuleEvents issues GET /api/rules/:id/events with limit + before', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const { wrapper } = makeWrapper();
    renderHook(() => useRuleEvents('r1', { limit: 25, before: 1_700_000_000 }), { wrapper });
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toEqual('/api/rules/r1/events?limit=25&before=1700000000');
  });

  it('useSymbolRuleEvents issues GET /api/symbols/:id/rule-events with limit + before', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const { wrapper } = makeWrapper();
    renderHook(() => useSymbolRuleEvents('crypto:BTCUSDT', { limit: 15, before: 1_700_000_000 }), {
      wrapper,
    });
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toEqual(
      '/api/symbols/crypto%3ABTCUSDT/rule-events?limit=15&before=1700000000',
    );
  });

  it('useSymbolRuleEventsCount issues GET /api/symbols/:id/rule-events/count and returns the count integer', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ count: 7 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useSymbolRuleEventsCount('crypto:BTCUSDT'), { wrapper });
    await waitFor(() => {
      expect(result.current.data).toEqual(7);
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toEqual('/api/symbols/crypto%3ABTCUSDT/rule-events/count');
  });
});
