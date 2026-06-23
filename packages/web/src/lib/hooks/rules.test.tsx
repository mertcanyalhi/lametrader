// @vitest-environment jsdom
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
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type RuleInput,
  rulesListKey,
  useCreateRule,
  useDeleteRule,
  usePatchRule,
  useReorderRules,
  useReplaceRule,
  useRule,
  useRuleEvents,
  useRules,
  useSymbolRuleEvents,
} from './rules';

/**
 * Build a minimal `RuleInput` used as the create / replace payload. The
 * domain validator runs on the server; the client only needs the field
 * coverage TanStack Query serializes.
 */
function ruleInput(): RuleInput {
  return {
    profileId: 'p1',
    name: 'r',
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
  };
}

/** A skeleton `Rule` the fake API can echo back to the client. */
function ruleResponse(overrides: Partial<Rule> & Pick<Rule, 'id'>): Rule {
  return {
    ...ruleInput(),
    events: [],
    history: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
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
    client: QueryClient;
  } {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return { wrapper, client };
  }

  it('useRules issues GET /api/rules and returns the list', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([ruleResponse({ id: 'r1' })]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useRules(), { wrapper });
    await waitFor(() => {
      expect(result.current.data?.map((r) => r.id)).toEqual(['r1']);
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/rules');
  });

  it('useRules threads filters into the query string', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const { wrapper } = makeWrapper();
    renderHook(() => useRules({ profileId: 'p1', symbolId: 'crypto:BTCUSDT' }), { wrapper });
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/rules?profileId=p1&symbolId=crypto%3ABTCUSDT');
  });

  it('useRule issues GET /api/rules/:id', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(ruleResponse({ id: 'r1' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useRule('r1'), { wrapper });
    await waitFor(() => {
      expect(result.current.data?.id).toBe('r1');
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/rules/r1');
  });

  it('useCreateRule POSTs to /api/rules with the input as the body', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(ruleResponse({ id: 'r1' })), {
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
    }).toEqual({
      url: '/api/rules',
      method: 'POST',
      body: JSON.stringify(input),
    });
  });

  it('useReplaceRule PUTs to /api/rules/:id with the input', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(ruleResponse({ id: 'r1' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useReplaceRule(), { wrapper });
    const input = ruleInput();
    await act(async () => {
      await result.current.mutateAsync({ id: 'r1', input });
    });
    const init = (fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined) ?? {};
    expect({
      url: fetchSpy.mock.calls[0]?.[0],
      method: init.method,
      body: init.body,
    }).toEqual({
      url: '/api/rules/r1',
      method: 'PUT',
      body: JSON.stringify(input),
    });
  });

  it('usePatchRule PATCHes to /api/rules/:id with { enabled }', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(ruleResponse({ id: 'r1' })), {
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

  it('useDeleteRule DELETEs /api/rules/:id', async () => {
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

  it('useReorderRules PUTs to /api/rules/order with { ids }', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useReorderRules(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(['r2', 'r1']);
    });
    const init = (fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined) ?? {};
    expect({
      url: fetchSpy.mock.calls[0]?.[0],
      method: init.method,
      body: init.body,
    }).toEqual({
      url: '/api/rules/order',
      method: 'PUT',
      body: JSON.stringify({ ids: ['r2', 'r1'] }),
    });
  });

  it('useRuleEvents GETs /api/rules/:id/events?limit&before', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const { wrapper } = makeWrapper();
    renderHook(() => useRuleEvents('r1', { limit: 10, before: 5000 }), { wrapper });
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/rules/r1/events?limit=10&before=5000');
  });

  it('useSymbolRuleEvents GETs /api/symbols/:id/rule-events', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const { wrapper } = makeWrapper();
    renderHook(() => useSymbolRuleEvents('crypto:BTCUSDT'), { wrapper });
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/symbols/crypto%3ABTCUSDT/rule-events');
  });

  it('useSymbolRuleEvents threads `limit` and `before` into the query string', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const { wrapper } = makeWrapper();
    renderHook(() => useSymbolRuleEvents('crypto:BTCUSDT', { limit: 10, before: 5000 }), {
      wrapper,
    });
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      '/api/symbols/crypto%3ABTCUSDT/rule-events?limit=10&before=5000',
    );
  });

  it('useSymbolRuleEvents resolves with the empty page when the API returns []', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useSymbolRuleEvents('crypto:BTCUSDT'), { wrapper });
    await waitFor(() => {
      expect(result.current.data).toEqual([]);
    });
  });

  it('usePatchRule flips the cached list entry optimistically before the request resolves', async () => {
    let resolveFetch: (response: Response) => void = () => {};
    fetchSpy.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const { wrapper, client } = makeWrapper();
    client.setQueryData(rulesListKey({ profileId: 'p1' }), [ruleResponse({ id: 'r1' })]);
    const { result } = renderHook(() => usePatchRule(), { wrapper });

    act(() => {
      result.current.mutate({ id: 'r1', patch: { enabled: false } });
    });

    await waitFor(() => {
      const list = client.getQueryData<Rule[]>(rulesListKey({ profileId: 'p1' }));
      expect(list?.[0]?.enabled).toBe(false);
    });

    resolveFetch(
      new Response(JSON.stringify(ruleResponse({ id: 'r1', enabled: false })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  it('usePatchRule rolls the cached list back to the pre-mutation snapshot when the request fails', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'boom' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { wrapper, client } = makeWrapper();
    const before = [ruleResponse({ id: 'r1' })];
    client.setQueryData(rulesListKey({ profileId: 'p1' }), before);
    const { result } = renderHook(() => usePatchRule(), { wrapper });

    await act(async () => {
      try {
        await result.current.mutateAsync({ id: 'r1', patch: { enabled: false } });
      } catch {
        // expected
      }
    });

    expect(client.getQueryData<Rule[]>(rulesListKey({ profileId: 'p1' }))?.[0]?.enabled).toBe(true);
  });
});
