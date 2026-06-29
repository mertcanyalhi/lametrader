// @vitest-environment jsdom
import { RulesV2, StateValueType } from '@lametrader/core';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type RuleV2Input,
  useCreateRuleV2,
  useDeleteRuleV2,
  usePatchRuleV2,
  useRulesV2,
  useRuleV2,
  useRuleV2Events,
} from './rules-v2';

/** A minimal `RuleV2Input` shape — the server re-validates against the v2 schema. */
function ruleV2Input(): RuleV2Input {
  return {
    profileId: 'p1',
    name: 'r',
    order: 1,
    scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'crypto:BTCUSDT' },
    condition: {
      kind: RulesV2.ConditionNodeKind.Leaf,
      leaf: {
        family: RulesV2.LeafConditionFamily.Comparison,
        operator: RulesV2.ComparisonOperator.Gt,
        left: { kind: RulesV2.OperandKind.Price },
        right: {
          kind: RulesV2.OperandKind.Literal,
          value: { type: StateValueType.Number, value: 100 },
        },
      },
    },
    trigger: { kind: RulesV2.TriggerKind.Once },
    expiration: null,
    actions: [
      {
        kind: RulesV2.ActionKind.Notification,
        channel: RulesV2.NotificationChannel.Telegram,
        destinationName: 'main',
        template: 'hi',
      },
    ],
    enabled: true,
  };
}

/** A skeleton {@link RulesV2.Rule} the fake API can echo back to the client. */
function ruleV2Response(id: string): RulesV2.Rule {
  return {
    ...ruleV2Input(),
    id,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('rules-v2 hooks', () => {
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

  it('useRulesV2 issues GET /api/v2/rules and returns the list', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([ruleV2Response('r1')]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useRulesV2(), { wrapper });
    await waitFor(() => {
      expect(result.current.data?.map((r) => r.id)).toEqual(['r1']);
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toEqual('/api/v2/rules');
  });

  it('useRulesV2 threads profileId / symbolId / enabled into the query string', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const { wrapper } = makeWrapper();
    renderHook(() => useRulesV2({ profileId: 'p1', symbolId: 'crypto:BTCUSDT', enabled: true }), {
      wrapper,
    });
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toEqual(
      '/api/v2/rules?profileId=p1&symbolId=crypto%3ABTCUSDT&enabled=true',
    );
  });

  it('useRuleV2 issues GET /api/v2/rules/:id', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(ruleV2Response('r1')), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useRuleV2('r1'), { wrapper });
    await waitFor(() => {
      expect(result.current.data?.id).toEqual('r1');
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toEqual('/api/v2/rules/r1');
  });

  it('useCreateRuleV2 POSTs to /api/v2/rules with the input body', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(ruleV2Response('r1')), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useCreateRuleV2(), { wrapper });
    const input = ruleV2Input();
    await act(async () => {
      await result.current.mutateAsync(input);
    });
    const init = (fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined) ?? {};
    expect({
      url: fetchSpy.mock.calls[0]?.[0],
      method: init.method,
      body: init.body,
    }).toEqual({ url: '/api/v2/rules', method: 'POST', body: JSON.stringify(input) });
  });

  it('usePatchRuleV2 PATCHes /api/v2/rules/:id with the partial body', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(ruleV2Response('r1')), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => usePatchRuleV2(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 'r1', patch: { enabled: false } });
    });
    const init = (fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined) ?? {};
    expect({
      url: fetchSpy.mock.calls[0]?.[0],
      method: init.method,
      body: init.body,
    }).toEqual({
      url: '/api/v2/rules/r1',
      method: 'PATCH',
      body: JSON.stringify({ enabled: false }),
    });
  });

  it('useDeleteRuleV2 DELETEs /api/v2/rules/:id and returns undefined on 204', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useDeleteRuleV2(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync('r1');
    });
    const init = (fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined) ?? {};
    expect({ url: fetchSpy.mock.calls[0]?.[0], method: init.method }).toEqual({
      url: '/api/v2/rules/r1',
      method: 'DELETE',
    });
  });

  it('useRuleV2Events issues GET /api/v2/rules/:id/events with limit + before', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const { wrapper } = makeWrapper();
    renderHook(() => useRuleV2Events('r1', { limit: 25, before: 1_700_000_000 }), { wrapper });
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toEqual(
      '/api/v2/rules/r1/events?limit=25&before=1700000000',
    );
  });
});
