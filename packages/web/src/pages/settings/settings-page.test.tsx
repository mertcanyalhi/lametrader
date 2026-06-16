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

  beforeEach(() => {
    fetchSpy = vi.fn();
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
   * Resolve the next `fetch` call with the given JSON body and status.
   */
  function mockJsonResponse(body: unknown, status = 200): void {
    fetchSpy.mockResolvedValueOnce(
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

    // Wait for the form, then toggle off 1d to make the form dirty.
    const oneDayToggle = await screen.findByRole('button', { name: '1d', pressed: true });
    await user.click(oneDayToggle);

    // Click Save.
    const saveButton = screen.getByRole('button', { name: /save/i });
    await waitFor(() => expect(saveButton).not.toBeDisabled());

    // Open the Select and pick 1h as the new default (since 1d is no longer enabled).
    const defaultPeriodTrigger = screen.getByRole('combobox', { name: /default period/i });
    await user.click(defaultPeriodTrigger);
    const option = await screen.findByRole('option', { name: '1h' });
    await user.click(option);

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

  it('renders the form-level inline error when the client-side resolver rejects the submit', async () => {
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
    await waitFor(() => expect(saveButton).not.toBeDisabled());
    await act(async () => {
      await user.click(saveButton);
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('periods must not be empty');
    });
    // No PUT was issued — only the initial GET.
    expect(
      fetchSpy.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'PUT'),
    ).toEqual([]);
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
});
