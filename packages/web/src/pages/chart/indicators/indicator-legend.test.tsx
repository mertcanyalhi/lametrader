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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LegendOverlay } from './indicator-legend.js';
import { IndicatorLegend } from './indicator-legend.js';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

const SMA_DEFINITION: IndicatorDefinition = {
  key: 'sma',
  name: 'Simple Moving Average',
  description: '',
  version: 1,
  appliesTo: [SymbolType.Crypto],
  inputs: [
    { type: FieldType.Number, key: 'length', label: 'Length', default: 14 },
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

const SMA_INSTANCE: IndicatorInstance = {
  id: 'inst-sma',
  indicatorKey: 'sma',
  version: 1,
  inputs: { length: 14, source: PriceSource.Close },
  summary: 'SMA 14 close',
};

const NOW = 1_700_000_000_000;

const PROFILE: Profile = {
  id: 'p-1',
  name: 'Scalper',
  description: '',
  enabled: true,
  scope: { type: ProfileScope.All },
  createdAt: NOW,
  updatedAt: NOW,
  indicators: [SMA_INSTANCE],
};

/** A legend overlay row with three state points, one warm-up. */
function smaOverlay(visible = true): LegendOverlay {
  return {
    instance: SMA_INSTANCE,
    definition: SMA_DEFINITION,
    color: '#3aa3ff',
    visible,
    state: [
      { time: 1000, value: null },
      { time: 2000, value: 105.5 },
      { time: 3000, value: 106.25 },
    ],
  };
}

interface FetchCall {
  url: string;
  method: string;
}

describe('IndicatorLegend', () => {
  let queryClient: QueryClient;
  let calls: FetchCall[];

  beforeEach(() => {
    calls = [];
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function renderLegend(props: {
    overlays: LegendOverlay[];
    hoveredTime?: number | null;
    onToggleVisible?: (instanceId: string) => void;
    profile?: Profile | null;
  }): void {
    render(
      <QueryClientProvider client={queryClient}>
        <Theme>
          <IndicatorLegend
            overlays={props.overlays}
            hoveredTime={props.hoveredTime ?? null}
            onToggleVisible={props.onToggleVisible ?? (() => {})}
            profile={props.profile ?? PROFILE}
          />
        </Theme>
      </QueryClientProvider>,
    );
  }

  it("renders one row per overlay with the instance's summary as the label, plus a coloured swatch (no separate indicator title)", () => {
    renderLegend({ overlays: [smaOverlay()] });

    const row = screen.getByRole('listitem', { name: 'SMA 14 close' });
    const swatch = within(row).getByTestId('overlay-swatch');
    expect({
      summary: within(row).queryByText('SMA 14 close') !== null,
      // The indicator's `name` is no longer shown — the summary is the label.
      indicatorName: within(row).queryByText('Simple Moving Average'),
      swatchColor: swatch.style.backgroundColor,
    }).toEqual({
      summary: true,
      indicatorName: null,
      // jsdom normalizes `#3aa3ff` to `rgb(58, 163, 255)`.
      swatchColor: 'rgb(58, 163, 255)',
    });
  });

  it('renders the state value at the hovered time formatted with two decimals', () => {
    renderLegend({ overlays: [smaOverlay()], hoveredTime: 2000 });

    const row = screen.getByRole('listitem', { name: 'SMA 14 close' });
    expect(within(row).getByText('105.50')).toBeInTheDocument();
  });

  it('renders the latest state value when no crosshair time is set', () => {
    renderLegend({ overlays: [smaOverlay()], hoveredTime: null });

    const row = screen.getByRole('listitem', { name: 'SMA 14 close' });
    expect(within(row).getByText('106.25')).toBeInTheDocument();
  });

  it('formats sub-1 values with magnitude-aware decimals — never collapses to 2dp like toFixed(2)', () => {
    // A low-unit crypto cross like 0.022693 should keep its significant figures
    // (5 decimals = leading-zero count + 4), matching the chart's price axis.
    const overlay: LegendOverlay = {
      instance: SMA_INSTANCE,
      definition: SMA_DEFINITION,
      color: '#3aa3ff',
      visible: true,
      state: [{ time: 1000, value: 0.022693 }],
    };
    renderLegend({ overlays: [overlay], hoveredTime: 1000 });

    const row = screen.getByRole('listitem', { name: 'SMA 14 close' });
    expect(within(row).getByText('0.02269')).toBeInTheDocument();
  });

  it('fires onToggleVisible(instanceId) when the eye toggle is clicked', async () => {
    const onToggleVisible = vi.fn();
    renderLegend({ overlays: [smaOverlay()], onToggleVisible });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Hide overlay' }));

    expect(onToggleVisible.mock.calls).toEqual([[SMA_INSTANCE.id]]);
  });

  it('opens a confirm dialog from the remove button and DELETEs /profiles/:id/indicators/:instanceId on confirm', async () => {
    renderLegend({ overlays: [smaOverlay()] });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Remove overlay' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Detach' }));

    await waitFor(() =>
      expect(calls).toEqual([
        { url: `/api/profiles/${PROFILE.id}/indicators/${SMA_INSTANCE.id}`, method: 'DELETE' },
      ]),
    );
  });
});
