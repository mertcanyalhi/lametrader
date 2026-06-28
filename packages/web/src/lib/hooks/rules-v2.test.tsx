// @vitest-environment jsdom
import { RulesV2, StateValueType } from '@lametrader/core';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type RuleV2Input,
  rulesV2ListKey,
  useCreateRuleV2,
  useDeleteRuleV2,
  useReplaceRuleV2,
  useRulesV2,
} from './rules-v2';

/**
 * Build a minimal {@link RuleV2Input} suitable for round-tripping through
 * `POST /v2/rules`. Mirrors a real-world `Price > 100` rule on one symbol.
 */
function ruleV2Input(): RuleV2Input {
  return {
    profileId: 'p1',
    name: 'r',
    order: 1,
    scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'BTC' },
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
    trigger: { kind: RulesV2.TriggerKind.EveryTime },
    expiration: null,
    actions: [
      {
        kind: RulesV2.ActionKind.Notification,
        channel: RulesV2.NotificationChannel.Telegram,
        destinationName: 'main',
        template: 'fired {symbolId}',
      },
    ],
    enabled: true,
  };
}

/** Build a v2 rule the fake API echoes back to the client. */
function ruleV2Response(overrides: Partial<RulesV2.Rule> & Pick<RulesV2.Rule, 'id'>): RulesV2.Rule {
  return {
    ...ruleV2Input(),
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
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

  /**
   * Build a fresh `QueryClient` + provider wrapper for one test. Retries off so
   * mocked failures surface immediately as the hook's `error` state.
   */
  function makeWrapper(): {
    client: QueryClient;
    wrapper: ({ children }: { children: ReactNode }) => ReactNode;
  } {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return { client, wrapper };
  }

  it('useRulesV2 GETs /api/v2/rules?profileId=p1 and returns the parsed rule array', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([ruleV2Response({ id: 'r1' })]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useRulesV2({ profileId: 'p1' }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect({
      url: fetchSpy.mock.calls[0]?.[0],
      data: result.current.data,
    }).toEqual({
      url: '/api/v2/rules?profileId=p1',
      data: [ruleV2Response({ id: 'r1' })],
    });
  });

  it('useCreateRuleV2 POSTs the input to /api/v2/rules and seeds every list cache on success', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(ruleV2Response({ id: 'r1' })), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([ruleV2Response({ id: 'r1' })]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { client, wrapper } = makeWrapper();
    client.setQueryData(rulesV2ListKey({ profileId: 'p1' }), [] as RulesV2.Rule[]);

    const { result } = renderHook(() => useCreateRuleV2(), { wrapper });
    let returned: RulesV2.Rule | undefined;
    await act(async () => {
      returned = await result.current.mutateAsync(ruleV2Input());
    });

    expect({
      method: (fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined)?.method,
      url: fetchSpy.mock.calls[0]?.[0],
      body: JSON.parse(
        ((fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined)?.body as string) ?? 'null',
      ),
      returned,
    }).toEqual({
      method: 'POST',
      url: '/api/v2/rules',
      body: ruleV2Input(),
      returned: ruleV2Response({ id: 'r1' }),
    });
  });

  it('useReplaceRuleV2 PATCHes /api/v2/rules/:id with the patch body', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(ruleV2Response({ id: 'r1', enabled: false })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([ruleV2Response({ id: 'r1', enabled: false })]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useReplaceRuleV2(), { wrapper });
    let returned: RulesV2.Rule | undefined;
    await act(async () => {
      returned = await result.current.mutateAsync({ id: 'r1', patch: { enabled: false } });
    });

    expect({
      method: (fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined)?.method,
      url: fetchSpy.mock.calls[0]?.[0],
      body: JSON.parse(
        ((fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined)?.body as string) ?? 'null',
      ),
      returned,
    }).toEqual({
      method: 'PATCH',
      url: '/api/v2/rules/r1',
      body: { enabled: false },
      returned: ruleV2Response({ id: 'r1', enabled: false }),
    });
  });

  it('useDeleteRuleV2 DELETEs /api/v2/rules/:id and removes the row from every cached list', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([] as RulesV2.Rule[]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { client, wrapper } = makeWrapper();
    const listKey = rulesV2ListKey({ profileId: 'p1' });
    client.setQueryData(listKey, [ruleV2Response({ id: 'r1' }), ruleV2Response({ id: 'r2' })]);

    const { result } = renderHook(() => useDeleteRuleV2(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync('r1');
    });

    expect({
      method: (fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined)?.method,
      url: fetchSpy.mock.calls[0]?.[0],
      cachedIds: (client.getQueryData<RulesV2.Rule[]>(listKey) ?? []).map((rule) => rule.id),
    }).toEqual({
      method: 'DELETE',
      url: '/api/v2/rules/r1',
      cachedIds: ['r2'],
    });
  });
});
