// @vitest-environment jsdom
import { type Profile, ProfileScope, StateValueType, SymbolType } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setStoredStateOverlays } from '../../../lib/chart-state-overlays.js';
import { setStoredProfileId } from '../../../lib/selected-profile.js';
import { SelectedProfileProvider } from '../../../lib/selected-profile-context.js';
import { StatesPanelDialog } from './states-panel-dialog.js';

const NOW = 1_700_000_000_000;

const PROFILE: Profile = {
  id: 'p-1',
  name: 'Scalper',
  description: '',
  enabled: true,
  scope: { type: ProfileScope.All },
  createdAt: NOW,
  updatedAt: NOW,
  indicators: [],
  chartStates: [],
};

const SYMBOL_ID = 'crypto:BTCUSDT';

interface FetchCall {
  url: string;
  method: string;
}

interface Matcher {
  match: (url: string, method: string) => boolean;
  respond: () => { status: number; body: unknown };
}

describe('StatesPanelDialog', () => {
  let queryClient: QueryClient;
  let calls: FetchCall[];
  let matchers: Matcher[];
  let profiles: Profile[];
  let stateKeys: Array<{ key: string; valueType: string }>;

  beforeEach(() => {
    calls = [];
    matchers = [];
    profiles = [PROFILE];
    stateKeys = [
      { key: 'cooldown', valueType: StateValueType.Number },
      { key: 'last_signal', valueType: StateValueType.String },
    ];
    matchers.push({
      match: (url, method) => method === 'GET' && url.endsWith('/profiles'),
      respond: () => ({ status: 200, body: profiles }),
    });
    matchers.push({
      match: (url, method) =>
        method === 'GET' && url === `/api/symbols/${encodeURIComponent(SYMBOL_ID)}/state-keys`,
      respond: () => ({ status: 200, body: stateKeys }),
    });
    matchers.push({
      match: (url, method) =>
        method === 'GET' && url.startsWith(`/api/symbols/${encodeURIComponent(SYMBOL_ID)}/state?`),
      respond: () => ({
        status: 200,
        body: {
          cooldown: { type: StateValueType.Number, value: 3 },
          last_signal: { type: StateValueType.String, value: 'buy' },
        },
      }),
    });

    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
      const matcher = matchers.find((m) => m.match(url, method));
      if (!matcher) throw new Error(`unexpected fetch: ${method} ${url}`);
      const { status, body } = matcher.respond();
      return new Response(JSON.stringify(body), {
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

  function renderPanel(
    symbolType: SymbolType = SymbolType.Crypto,
    opts: { onChange?: (next: string[]) => void } = {},
  ): void {
    render(
      <QueryClientProvider client={queryClient}>
        <Theme>
          <SelectedProfileProvider>
            <StatesPanelDialog
              symbolId={SYMBOL_ID}
              symbolType={symbolType}
              onChange={opts.onChange}
            />
          </SelectedProfileProvider>
        </Theme>
      </QueryClientProvider>,
    );
  }

  it('exposes "State changes" as both the trigger accessible name and visible label when no profile is selected', async () => {
    profiles = [];
    renderPanel();

    const button = await screen.findByRole('button', { name: 'State changes' });
    expect({
      accessibleName: button.getAttribute('aria-label'),
      visibleLabel: button.textContent,
    }).toEqual({ accessibleName: 'State changes', visibleLabel: 'State changes' });
  });

  it('labels the trigger "State changes (N)" with the count of currently overlaid keys for (profileId, symbolId)', async () => {
    setStoredProfileId(PROFILE.id);
    setStoredStateOverlays(PROFILE.id, SYMBOL_ID, ['cooldown', 'last_signal']);
    renderPanel();

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'State changes (2)' })).not.toBeNull(),
    );
  });

  it('titles the opened dialog "State changes" when a profile is selected', async () => {
    setStoredProfileId(PROFILE.id);
    renderPanel();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'State changes (0)' }));

    const dialog = await screen.findByRole('dialog');
    expect({
      title: within(dialog).getByRole('heading').textContent,
    }).toEqual({ title: 'State changes' });
  });

  it('renders a warning callout and no checkboxes when no profile is selected', async () => {
    profiles = [];
    renderPanel();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'State changes' }));

    const dialog = await screen.findByRole('dialog');
    expect({
      title: within(dialog).getByRole('heading').textContent,
      warning: within(dialog).queryByText(/select or create a profile to overlay states/i) !== null,
      checkboxes: within(dialog).queryAllByRole('checkbox').length,
    }).toEqual({ title: 'State changes', warning: true, checkboxes: 0 });
  });

  it('opens a dialog with a search input and one checkbox per state-key returned by the API', async () => {
    setStoredProfileId(PROFILE.id);
    renderPanel();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'State changes (0)' }));

    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('textbox', { name: 'Search state keys' });
    const cooldown = await within(dialog).findByRole('checkbox', { name: 'cooldown' });
    const lastSignal = await within(dialog).findByRole('checkbox', { name: 'last_signal' });
    expect({
      cooldownChecked: cooldown.getAttribute('aria-checked'),
      lastSignalChecked: lastSignal.getAttribute('aria-checked'),
    }).toEqual({ cooldownChecked: 'false', lastSignalChecked: 'false' });
  });

  it('shows the latest value for each state key', async () => {
    setStoredProfileId(PROFILE.id);
    renderPanel();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'State changes (0)' }));

    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('checkbox', { name: 'cooldown' });
    expect({
      cooldown: within(dialog).queryByText('3') !== null,
      lastSignal: within(dialog).queryByText('buy') !== null,
    }).toEqual({ cooldown: true, lastSignal: true });
  });

  it('toggling a checkbox persists the next selection to localStorage and bumps the badge count', async () => {
    setStoredProfileId(PROFILE.id);
    const onChange = vi.fn<(next: string[]) => void>();
    renderPanel(SymbolType.Crypto, { onChange });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'State changes (0)' }));

    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByRole('checkbox', { name: 'cooldown' }));

    // localStorage now holds the single selected key.
    await waitFor(() => {
      expect(window.localStorage.getItem(`chart-state-overlays::${PROFILE.id}::${SYMBOL_ID}`)).toBe(
        JSON.stringify(['cooldown']),
      );
    });
    expect(onChange).toHaveBeenCalledWith(['cooldown']);
  });
});
