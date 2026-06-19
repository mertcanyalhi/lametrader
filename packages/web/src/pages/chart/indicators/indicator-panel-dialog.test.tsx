// @vitest-environment jsdom
import {
  FieldType,
  type IndicatorDefinition,
  type IndicatorInstance,
  Pane,
  PriceSource,
  type Profile,
  ProfileScope,
  RenderKind,
  SymbolType,
} from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setStoredProfileId } from '../../../lib/selected-profile.js';
import { SelectedProfileProvider } from '../../../lib/selected-profile-context.js';
import { IndicatorPanelDialog } from './indicator-panel-dialog.js';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

const NOW = 1_700_000_000_000;

const SMA_DEFINITION: IndicatorDefinition = {
  key: 'sma',
  name: 'Simple Moving Average',
  description: 'Mean of the resolved source price over the last `length` candles.',
  version: 1,
  appliesTo: [SymbolType.Crypto, SymbolType.Stock, SymbolType.Fund, SymbolType.Fx],
  inputs: [
    {
      type: FieldType.Number,
      key: 'length',
      label: 'Length',
      integer: true,
      min: 1,
      max: 1_000,
      default: 14,
    },
    { type: FieldType.Source, key: 'source', label: 'Source', default: PriceSource.Close },
  ],
  state: [
    {
      type: FieldType.Number,
      key: 'value',
      label: 'SMA',
      render: RenderKind.Line,
      pane: Pane.Overlay,
    },
  ],
};

/** A crypto-only indicator used by the n/a-on-fx-symbol test. */
const CRYPTO_ONLY_DEFINITION: IndicatorDefinition = {
  key: 'vwma',
  name: 'Volume-Weighted Moving Average',
  description: 'volume-weighted',
  version: 1,
  appliesTo: [SymbolType.Crypto],
  inputs: [
    {
      type: FieldType.Number,
      key: 'length',
      label: 'Length',
      integer: true,
      min: 1,
      max: 1_000,
      default: 20,
    },
  ],
  state: [
    {
      type: FieldType.Number,
      key: 'value',
      label: 'VWMA',
      render: RenderKind.Line,
      pane: Pane.Overlay,
    },
  ],
};

const SMA_INSTANCE: IndicatorInstance = {
  id: 'inst-sma',
  indicatorKey: 'sma',
  version: 1,
  inputs: { length: 14, source: PriceSource.Close },
};

const VWMA_INSTANCE: IndicatorInstance = {
  id: 'inst-vwma',
  indicatorKey: 'vwma',
  version: 1,
  inputs: { length: 20 },
};

const PROFILE: Profile = {
  id: 'p-1',
  name: 'Scalper',
  description: '',
  enabled: true,
  scope: { type: ProfileScope.All },
  createdAt: NOW,
  updatedAt: NOW,
  indicators: [SMA_INSTANCE, VWMA_INSTANCE],
};

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

interface Matcher {
  match: (url: string, method: string) => boolean;
  respond: () => { status: number; body: unknown };
}

describe('IndicatorPanelDialog', () => {
  let queryClient: QueryClient;
  let calls: FetchCall[];
  let matchers: Matcher[];
  let profiles: Profile[];
  let catalog: IndicatorDefinition[];

  beforeEach(() => {
    calls = [];
    matchers = [];
    profiles = [PROFILE];
    catalog = [SMA_DEFINITION, CRYPTO_ONLY_DEFINITION];
    matchers.push({
      match: (url, method) => method === 'GET' && url.endsWith('/profiles'),
      respond: () => ({ status: 200, body: profiles }),
    });
    matchers.push({
      match: (url, method) => method === 'GET' && url.endsWith('/indicators'),
      respond: () => ({ status: 200, body: catalog }),
    });

    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      const matcher = matchers.find((m) => m.match(url, method));
      if (!matcher) throw new Error(`unexpected fetch: ${method} ${url}`);
      const { status, body: responseBody } = matcher.respond();
      return new Response(status === 204 ? null : JSON.stringify(responseBody), {
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

  function renderPanel(symbolType: SymbolType = SymbolType.Crypto): void {
    render(
      <QueryClientProvider client={queryClient}>
        <Theme>
          <SelectedProfileProvider>
            <IndicatorPanelDialog symbolType={symbolType} />
          </SelectedProfileProvider>
        </Theme>
      </QueryClientProvider>,
    );
  }

  async function openPanel(triggerName: RegExp | string): Promise<void> {
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: triggerName }));
    await screen.findByRole('dialog');
  }

  it('labels the trigger "Indicators" when no profile is selected', async () => {
    profiles = [];
    renderPanel();

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Indicators' })).not.toBeNull(),
    );
  });

  it('labels the trigger "Indicators (N)" with the selected profile\'s instance count', async () => {
    setStoredProfileId(PROFILE.id);
    renderPanel();

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Indicators (2)' })).not.toBeNull(),
    );
  });

  it('renders a warning callout and no "Add indicator" button when no profile is selected', async () => {
    profiles = [];
    renderPanel();
    await openPanel('Indicators');

    const dialog = screen.getByRole('dialog');
    expect({
      warning: within(dialog).queryByText(/select or create a profile to add indicators/i) !== null,
      addButton: within(dialog).queryByRole('button', { name: /add indicator/i }),
    }).toEqual({ warning: true, addButton: null });
  });

  it('lists every attached instance from the selected profile when opened', async () => {
    setStoredProfileId(PROFILE.id);
    renderPanel();
    await openPanel('Indicators (2)');

    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(within(dialog).queryByText(SMA_DEFINITION.name)).not.toBeNull());
    expect({
      sma: within(dialog).queryByText(SMA_DEFINITION.name) !== null,
      vwma: within(dialog).queryByText(CRYPTO_ONLY_DEFINITION.name) !== null,
    }).toEqual({ sma: true, vwma: true });
  });

  it("renders an instance whose definition's appliesTo excludes the current symbol's type muted with an n/a note", async () => {
    setStoredProfileId(PROFILE.id);
    renderPanel(SymbolType.Fx);
    await openPanel('Indicators (2)');

    const dialog = screen.getByRole('dialog');
    await waitFor(() =>
      expect(within(dialog).queryByText(CRYPTO_ONLY_DEFINITION.name)).not.toBeNull(),
    );
    expect(within(dialog).queryByText(/n\/a for fx/i)).not.toBeNull();
  });

  it('attaches a new indicator via POST /profiles/:id/indicators when "Add indicator" → catalog pick → submit', async () => {
    profiles = [{ ...PROFILE, indicators: [] }];
    setStoredProfileId(PROFILE.id);
    const newInstance: IndicatorInstance = {
      id: 'inst-new',
      indicatorKey: 'sma',
      version: 1,
      inputs: { length: 14, source: PriceSource.Close },
    };
    matchers.push({
      match: (url, method) =>
        method === 'POST' && url.endsWith(`/profiles/${PROFILE.id}/indicators`),
      respond: () => {
        profiles = [{ ...PROFILE, indicators: [newInstance] }];
        return { status: 201, body: newInstance };
      },
    });
    renderPanel();
    await openPanel('Indicators (0)');
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /add indicator/i }));
    await user.click(await screen.findByRole('button', { name: new RegExp(SMA_DEFINITION.name) }));
    await user.click(await screen.findByRole('button', { name: /save|create|attach|submit/i }));

    await waitFor(() => {
      const post = calls.find(
        (c) => c.method === 'POST' && c.url.endsWith(`/profiles/${PROFILE.id}/indicators`),
      );
      expect(post?.body).toEqual({
        indicatorKey: 'sma',
        inputs: { length: 14, source: PriceSource.Close },
      });
    });
  });

  it('surfaces a 400 from POST /profiles/:id/indicators inline above the form footer', async () => {
    profiles = [{ ...PROFILE, indicators: [] }];
    setStoredProfileId(PROFILE.id);
    matchers.push({
      match: (url, method) =>
        method === 'POST' && url.endsWith(`/profiles/${PROFILE.id}/indicators`),
      respond: () => ({ status: 400, body: { error: 'length must be ≥ 1' } }),
    });
    renderPanel();
    await openPanel('Indicators (0)');
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /add indicator/i }));
    await user.click(await screen.findByRole('button', { name: new RegExp(SMA_DEFINITION.name) }));
    await user.click(await screen.findByRole('button', { name: /save|create|attach|submit/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('length must be ≥ 1');
  });

  it("edits an instance via PUT /profiles/:id/indicators/:instanceId when the row's edit button → submit is used", async () => {
    setStoredProfileId(PROFILE.id);
    const replaced: IndicatorInstance = {
      ...SMA_INSTANCE,
      inputs: { length: 21, source: PriceSource.Close },
    };
    matchers.push({
      match: (url, method) =>
        method === 'PUT' && url.endsWith(`/profiles/${PROFILE.id}/indicators/${SMA_INSTANCE.id}`),
      respond: () => {
        profiles = [{ ...PROFILE, indicators: [replaced, VWMA_INSTANCE] }];
        return { status: 200, body: replaced };
      },
    });
    renderPanel();
    await openPanel('Indicators (2)');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: `Edit ${SMA_DEFINITION.name}` }));
    const lengthField = await screen.findByRole('spinbutton', { name: 'Length' });
    await user.clear(lengthField);
    await user.type(lengthField, '21');
    await user.click(screen.getByRole('button', { name: /save|update|submit/i }));

    await waitFor(() => {
      const put = calls.find(
        (c) =>
          c.method === 'PUT' &&
          c.url.endsWith(`/profiles/${PROFILE.id}/indicators/${SMA_INSTANCE.id}`),
      );
      expect(put?.body).toEqual({
        indicatorKey: 'sma',
        inputs: { length: 21, source: PriceSource.Close },
      });
    });
  });

  it("detaches an instance via DELETE /profiles/:id/indicators/:instanceId when the row's delete button → confirm is used", async () => {
    setStoredProfileId(PROFILE.id);
    matchers.push({
      match: (url, method) =>
        method === 'DELETE' &&
        url.endsWith(`/profiles/${PROFILE.id}/indicators/${SMA_INSTANCE.id}`),
      respond: () => {
        profiles = [{ ...PROFILE, indicators: [VWMA_INSTANCE] }];
        return { status: 204, body: null };
      },
    });
    renderPanel();
    await openPanel('Indicators (2)');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: `Detach ${SMA_DEFINITION.name}` }));
    await user.click(await screen.findByRole('button', { name: 'Detach' }));

    await waitFor(() => {
      const del = calls.find(
        (c) =>
          c.method === 'DELETE' &&
          c.url.endsWith(`/profiles/${PROFILE.id}/indicators/${SMA_INSTANCE.id}`),
      );
      expect(del).not.toBeUndefined();
    });
  });
});
