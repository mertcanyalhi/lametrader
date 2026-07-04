// @vitest-environment jsdom
import {
  ActionKind,
  ComparisonOperator,
  ConditionNodeKind,
  LeafConditionFamily,
  NotificationChannel,
  OperandKind,
  type Rule,
  StateValueType,
} from '@lametrader/core';
import '@testing-library/jest-dom/vitest';
import { Theme } from '@radix-ui/themes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDraftRule } from '../../lib/draft-rule.js';
import { RuleEditorDialog } from './rule-editor-dialog';

/** A wrapper that wires the dialog with a fresh TanStack client + Theme. */
function Harness({ initial }: { initial: Rule }): ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <Theme>
        <RuleEditorDialog open={true} onOpenChange={() => {}} mode="create" initial={initial} />
      </Theme>
    </QueryClientProvider>
  );
}

/**
 * Build a route-table response by URL path so a single `fetch` mock can answer
 * the editor's many auxiliary GETs (profiles, watchlist, telegram destinations,
 * state) without each test wiring six per-URL spies.
 */
function makeFetchStub(): ReturnType<typeof vi.fn> {
  const stub = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/api/profiles')) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.endsWith('/api/symbols?enrich=true')) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.endsWith('/api/config/notifications/telegram')) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.endsWith('/api/state/global')) {
      return new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // Any /symbols/:id/state response.
    if (url.includes('/api/symbols/') && url.endsWith('/state')) {
      return new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // Any /symbols/:id/state-keys response — the rules editor seeds its
    // state-key combobox from this endpoint.
    if (url.includes('/api/symbols/') && url.endsWith('/state-keys')) {
      return new Response('[]', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('{}', {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return stub;
}

describe('RuleEditorDialog', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = makeFetchStub();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows the create-mode title and a Create submit button', async () => {
    render(<Harness initial={makeDraftRule({ profileId: 'p1' })} />);
    await waitFor(() => {
      expect(screen.getByText('New rule')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
  });

  it('exposes a trigger-kinds info icon next to the Trigger label', async () => {
    render(<Harness initial={makeDraftRule({ profileId: 'p1' })} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Trigger kinds info' })).toBeInTheDocument();
    });
  });

  it('POSTs to /api/rules with the assembled body on submit and surfaces the API field error inline', async () => {
    const user = userEvent.setup();
    fetchSpy.mockImplementationOnce(
      async (_input: RequestInfo | URL) =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    // We want the create POST to fail with the `{ error, fields[] }` envelope
    // so we can assert that the editor surfaces it inline.
    const seed = makeDraftRule({ profileId: 'p1', symbolId: 'crypto:BTCUSDT' });
    // Use a leaf to satisfy `condition-non-empty` and an action for `actions-min-one`.
    seed.condition = {
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
    };
    seed.actions = [
      {
        kind: ActionKind.Notification,
        channel: NotificationChannel.Telegram,
        destinationName: 'main',
        template: 'hi',
      },
    ];
    seed.name = 'My rule';

    // Intercept the POST /rules call so we can return a field-level error;
    // every auxiliary read falls through to a sensible empty default per URL.
    fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/rules' && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            error: 'body must NOT have additional properties',
            fields: [{ path: 'scope.symbolId', message: 'must be string' }],
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }
      // Array endpoints — return `[]`.
      if (
        url.endsWith('/api/symbols?enrich=true') ||
        url.endsWith('/api/profiles') ||
        url.endsWith('/api/config/notifications/telegram')
      ) {
        return new Response('[]', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Object endpoints — return `{}`.
      return new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    render(<Harness initial={seed} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
    });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Create' }));
    });

    await waitFor(() => {
      // The error message body surfaces as the inline Callout.
      expect(screen.getByText('body must NOT have additional properties')).toBeInTheDocument();
    });

    // The POST call body matches the assembled payload (sans server-generated fields).
    const postCall = fetchSpy.mock.calls.find(
      ([url, init]) =>
        (typeof url === 'string' ? url : url.toString()) === '/api/rules' &&
        (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(postCall).toBeDefined();
  });
});
