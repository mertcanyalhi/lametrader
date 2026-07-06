// @vitest-environment jsdom
import { Period } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './settings-page';

/**
 * Settings page tests — drive the real form against a mocked `fetch` boundary
 * so the real `apiFetch`, `QueryClient`, and `react-hook-form` are exercised.
 *
 * `sonner` is mocked at module level so the success toast is observable via
 * the spy without rendering the actual `<Toaster />`.
 */
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

import { toast } from 'sonner';

describe('SettingsPage', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let queryClient: QueryClient;
  /**
   * Queue of `/api/config` responses (FIFO). `mockJsonResponse` pushes here;
   * `/api/config/notifications` always returns `[]` so the Notifications tab's
   * query never consumes a queued config response.
   */
  let configResponses: Response[];

  beforeEach(() => {
    configResponses = [];
    fetchSpy = vi.fn(async (url: string) => {
      const path = String(url);
      if (path.endsWith('/config/notifications')) {
        return new Response('[]', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const next = configResponses.shift();
      if (!next) throw new Error(`unexpected fetch: ${url}`);
      return next;
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function renderPage(): void {
    render(
      <QueryClientProvider client={queryClient}>
        <Theme>
          <SettingsPage />
        </Theme>
      </QueryClientProvider>,
    );
  }

  /**
   * Queue the next `/api/config` response (GET or PUT consumed in order).
   * Calls to `/config/notifications` are not gated by this queue — they always
   * return `[]`.
   */
  function mockJsonResponse(body: unknown, status = 200): void {
    configResponses.push(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }

  it('populates the form from GET /api/config on mount', async () => {
    mockJsonResponse({
      periods: [Period.OneHour, Period.OneDay],
      defaultPeriod: Period.OneDay,
    });
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '1h', pressed: true })).toBeInTheDocument();
    });
    expect({
      oneMinute: screen.getByRole('button', { name: '1m' }).getAttribute('aria-pressed'),
      oneHour: screen.getByRole('button', { name: '1h' }).getAttribute('aria-pressed'),
      oneDay: screen.getByRole('button', { name: '1d' }).getAttribute('aria-pressed'),
      defaultPeriodTrigger: screen.getByRole('combobox', { name: /default period/i }).textContent,
    }).toEqual({
      oneMinute: 'false',
      oneHour: 'true',
      oneDay: 'true',
      defaultPeriodTrigger: '1d',
    });
  });

  it('renders a Skeleton placeholder while the initial GET /api/config is pending', () => {
    fetchSpy.mockReturnValueOnce(new Promise(() => undefined));
    renderPage();

    expect({
      hasSkeleton: screen.getByTestId('settings-skeleton') !== null,
      hasForm: screen.queryByRole('button', { name: '1h' }),
    }).toEqual({ hasSkeleton: true, hasForm: null });
  });

  it('renders an inline error Callout when the initial GET /api/config fails', async () => {
    mockJsonResponse({ error: 'database unavailable' }, 500);
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('database unavailable');
    });
    expect(screen.queryByRole('button', { name: '1h' })).toEqual(null);
  });

  it('keeps the Save button disabled until the form is dirty', async () => {
    mockJsonResponse({
      periods: [Period.OneHour, Period.OneDay],
      defaultPeriod: Period.OneDay,
    });
    renderPage();

    const saveButton = await screen.findByRole('button', { name: /save/i });
    expect(saveButton).toBeDisabled();
  });

  it('disables Save again after a successful save (resets the dirty baseline)', async () => {
    mockJsonResponse({
      periods: [Period.OneHour, Period.OneDay],
      defaultPeriod: Period.OneDay,
    });
    // PUT response — full replace; 1h toggled off, 1d remains the default.
    mockJsonResponse({
      periods: [Period.OneDay],
      defaultPeriod: Period.OneDay,
    });

    renderPage();
    const user = userEvent.setup();

    // Toggle off 1h (not the default), so the form is dirty but still valid.
    const oneHourToggle = await screen.findByRole('button', { name: '1h', pressed: true });
    await user.click(oneHourToggle);

    const saveButton = screen.getByRole('button', { name: /save/i });
    await waitFor(() => expect(saveButton).not.toBeDisabled());
    await act(async () => {
      await user.click(saveButton);
    });

    await waitFor(() => expect(saveButton).toBeDisabled());
  });

  it('clears defaultPeriod when its period is toggled off in the timeframe bar', async () => {
    mockJsonResponse({
      periods: [Period.OneHour, Period.OneDay],
      defaultPeriod: Period.OneDay,
    });
    renderPage();

    const user = userEvent.setup();
    const oneDayToggle = await screen.findByRole('button', { name: '1d', pressed: true });
    await user.click(oneDayToggle);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '1d' }).getAttribute('aria-pressed')).toEqual(
        'false',
      );
    });
    expect(screen.getByRole('combobox', { name: /default period/i }).textContent).toEqual(
      'Select default period',
    );
  });

  it('submits the form via PUT /api/config and surfaces the success toast on 200', async () => {
    mockJsonResponse({
      periods: [Period.OneHour, Period.OneDay],
      defaultPeriod: Period.OneDay,
    });
    // PUT response — full replace with one fewer period.
    mockJsonResponse({
      periods: [Period.OneHour],
      defaultPeriod: Period.OneHour,
    });

    renderPage();
    const user = userEvent.setup();

    // Toggle off 1d — this clears the default (1d was it), so we must pick a new
    // valid default before the form is savable.
    const oneDayToggle = await screen.findByRole('button', { name: '1d', pressed: true });
    await user.click(oneDayToggle);

    // Pick 1h as the new default (1d is no longer enabled).
    const defaultPeriodTrigger = screen.getByRole('combobox', { name: /default period/i });
    await user.click(defaultPeriodTrigger);
    const option = await screen.findByRole('option', { name: '1h' });
    await user.click(option);

    const saveButton = screen.getByRole('button', { name: /save/i });
    await waitFor(() => expect(saveButton).not.toBeDisabled());
    await act(async () => {
      await user.click(saveButton);
    });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/config',
        expect.objectContaining({ method: 'PUT' }),
      );
    });
    const putCall = fetchSpy.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'PUT',
    );
    const init = (putCall?.[1] as RequestInit | undefined) ?? {};
    expect({
      url: putCall?.[0],
      body: init.body,
      cached: queryClient.getQueryData(['config']),
      toastedWith: (toast.success as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0],
    }).toEqual({
      url: '/api/config',
      body: JSON.stringify({ periods: ['1h'], defaultPeriod: '1h' }),
      cached: { periods: [Period.OneHour], defaultPeriod: Period.OneHour },
      toastedWith: 'Settings saved',
    });
  });

  it('shows a field error and disables Save when no periods are selected, preventing the save', async () => {
    mockJsonResponse({
      periods: [Period.OneHour],
      defaultPeriod: Period.OneHour,
    });
    renderPage();

    const user = userEvent.setup();
    // Toggle the only period off so periods becomes [].
    const oneHourToggle = await screen.findByRole('button', { name: '1h', pressed: true });
    await user.click(oneHourToggle);

    const saveButton = screen.getByRole('button', { name: /save/i });
    await waitFor(() => {
      expect(screen.getByText('Select at least one period.')).toBeInTheDocument();
    });
    expect(saveButton).toBeDisabled();
    // No PUT was issued — only the initial GET.
    expect(
      fetchSpy.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'PUT'),
    ).toEqual([]);
  });

  it('shows a field error and disables Save when the default period is cleared', async () => {
    mockJsonResponse({
      periods: [Period.OneHour, Period.OneDay],
      defaultPeriod: Period.OneDay,
    });
    renderPage();

    const user = userEvent.setup();
    // Toggle off 1d — the current default — which clears the default selection.
    const oneDayToggle = await screen.findByRole('button', { name: '1d', pressed: true });
    await user.click(oneDayToggle);

    await waitFor(() => {
      expect(screen.getByText('Default period is required.')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('renders the server-supplied error inline when PUT /api/config returns 400, leaving the cache unchanged', async () => {
    mockJsonResponse({
      periods: [Period.OneHour, Period.OneDay],
      defaultPeriod: Period.OneDay,
    });
    // PUT rejected by the server.
    mockJsonResponse({ error: 'periods must not be empty' }, 400);

    renderPage();
    const user = userEvent.setup();

    // Force a dirty form by toggling 1h off — the resolver still passes because 1d remains.
    const oneHourToggle = await screen.findByRole('button', { name: '1h', pressed: true });
    await user.click(oneHourToggle);

    const saveButton = screen.getByRole('button', { name: /save/i });
    await waitFor(() => expect(saveButton).not.toBeDisabled());
    await act(async () => {
      await user.click(saveButton);
    });

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(within(alert).getByText('periods must not be empty')).toBeInTheDocument();
    });
    expect(queryClient.getQueryData(['config'])).toEqual({
      periods: [Period.OneHour, Period.OneDay],
      defaultPeriod: Period.OneDay,
    });
  });

  it('marks Save busy and disables the form controls while the save is in flight', async () => {
    mockJsonResponse({
      periods: [Period.OneHour, Period.OneDay],
      defaultPeriod: Period.OneDay,
    });
    // Hold the PUT pending so the in-flight state is observable. Queue the
    // pending promise as the next `/api/config` response — the destinations
    // GET takes a separate code path (always returns `[]`) so it can't
    // accidentally consume this slot.
    let resolvePut!: (response: Response) => void;
    configResponses.push(
      new Promise<Response>((resolve) => {
        resolvePut = resolve;
      }) as unknown as Response,
    );

    renderPage();
    const user = userEvent.setup();

    const oneHourToggle = await screen.findByRole('button', { name: '1h', pressed: true });
    await user.click(oneHourToggle);

    const saveButton = screen.getByRole('button', { name: /save/i });
    await waitFor(() => expect(saveButton).not.toBeDisabled());
    await user.click(saveButton);

    await waitFor(() => expect(saveButton).toHaveAttribute('aria-busy', 'true'));
    expect({
      saveBusy: saveButton.getAttribute('aria-busy'),
      saveDisabled: saveButton.hasAttribute('disabled'),
      periodDisabled: screen.getByRole('button', { name: '1d' }).hasAttribute('disabled'),
      selectDisabled: screen
        .getByRole('combobox', { name: /default period/i })
        .hasAttribute('disabled'),
    }).toEqual({
      saveBusy: 'true',
      saveDisabled: true,
      periodDisabled: true,
      selectDisabled: true,
    });

    // Resolve the PUT so the test doesn't leak a pending request.
    await act(async () => {
      resolvePut(
        new Response(JSON.stringify({ periods: [Period.OneDay], defaultPeriod: Period.OneDay }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
  });

  it('renders an info trigger for each settings block', async () => {
    mockJsonResponse({
      periods: [Period.OneHour, Period.OneDay],
      defaultPeriod: Period.OneDay,
    });
    renderPage();

    await screen.findByRole('button', { name: '1h' });
    expect({
      periods: screen
        .getByRole('button', { name: 'About the periods setting' })
        .getAttribute('aria-label'),
      defaultPeriod: screen
        .getByRole('button', { name: 'About the default period setting' })
        .getAttribute('aria-label'),
    }).toEqual({
      periods: 'About the periods setting',
      defaultPeriod: 'About the default period setting',
    });
  });

  it('opens a popover with the explanation when the info icon is clicked (works without hover)', async () => {
    mockJsonResponse({
      periods: [Period.OneHour, Period.OneDay],
      defaultPeriod: Period.OneDay,
    });
    renderPage();
    const user = userEvent.setup();

    const periodsInfo = await screen.findByRole('button', { name: 'About the periods setting' });
    await user.click(periodsInfo);

    expect(
      await screen.findByText(/the candle timeframes the platform tracks/i),
    ).toBeInTheDocument();
  });

  it('renders General and Notifications tabs with General selected by default', async () => {
    mockJsonResponse({
      periods: [Period.OneHour, Period.OneDay],
      defaultPeriod: Period.OneDay,
    });
    renderPage();

    await screen.findByRole('button', { name: '1h' });
    // Radix Themes renders each trigger label twice (a hidden bold-width
    // placeholder), doubling the accessible name — match it with a regex.
    expect({
      general: screen.getByRole('tab', { name: /General/ }).getAttribute('aria-selected'),
      notifications: screen
        .getByRole('tab', { name: /Notification Targets/ })
        .getAttribute('aria-selected'),
    }).toEqual({ general: 'true', notifications: 'false' });
  });

  it('shows the notifications section when the Notifications tab is activated', async () => {
    mockJsonResponse({
      periods: [Period.OneHour, Period.OneDay],
      defaultPeriod: Period.OneDay,
    });
    renderPage();
    const user = userEvent.setup();

    await screen.findByRole('button', { name: '1h' });
    await user.click(screen.getByRole('tab', { name: /Notification Targets/ }));

    expect(await screen.findByText('No notification targets configured.')).toBeInTheDocument();
  });
});
