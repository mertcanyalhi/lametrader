import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from './api-fetch';

/**
 * Tests for the `apiFetch` boundary wrapper. Mock `globalThis.fetch` so the
 * real status-mapping / error-surfacing logic runs.
 *
 * Failures are captured via {@link captureApiError} and asserted as a flat
 * object so the whole error payload is checked with a single `toEqual`.
 */
describe('apiFetch', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Await a call expected to reject with an {@link ApiError} and return it
   * (narrowed by `instanceof`, so no cast). Fails loudly if the promise
   * resolves or rejects with a different error type.
   */
  async function captureApiError(promise: Promise<unknown>): Promise<ApiError> {
    try {
      await promise;
    } catch (error) {
      if (error instanceof ApiError) {
        return error;
      }
      throw error;
    }
    throw new Error('expected the call to reject with an ApiError');
  }

  it('returns the parsed JSON body on a 200 response', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ value: 42 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(apiFetch('/config')).resolves.toEqual({ value: 42 });
  });

  it('returns undefined on a 204 response', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(apiFetch('/symbols/crypto:BTCUSDT', { method: 'DELETE' })).resolves.toEqual(
      undefined,
    );
  });

  it('propagates the server { error } message verbatim on a 400', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'periods must not be empty' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const error = await captureApiError(apiFetch('/config', { method: 'PUT', body: '{}' }));
    expect({ name: error.name, status: error.status, message: error.message }).toEqual({
      name: 'ApiError',
      status: 400,
      message: 'periods must not be empty',
    });
  });

  it('shows a clean status message instead of the raw HTML body on a 502', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('<html><body><h1>502 Bad Gateway</h1></body></html>', {
        status: 502,
        headers: { 'Content-Type': 'text/html' },
      }),
    );
    const error = await captureApiError(apiFetch('/config'));
    expect({ name: error.name, status: error.status, message: error.message }).toEqual({
      name: 'ApiError',
      status: 502,
      message: 'An unexpected error occurred: Bad gateway (502)',
    });
  });

  it('falls back to a generic unexpected-error message for an unmapped error status', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('', { status: 418 }));
    const error = await captureApiError(apiFetch('/config'));
    expect({ name: error.name, status: error.status, message: error.message }).toEqual({
      name: 'ApiError',
      status: 418,
      message: 'An unexpected error occurred: HTTP 418',
    });
  });

  it('shows an unexpected-error message when a non-2xx JSON body has an empty error string', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: '' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const error = await captureApiError(apiFetch('/config'));
    expect({ name: error.name, status: error.status, message: error.message }).toEqual({
      name: 'ApiError',
      status: 500,
      message: 'An unexpected error occurred: Internal server error (500)',
    });
  });

  it('raises an ApiError with status 0 and an unexpected-error message when fetch rejects', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const error = await captureApiError(apiFetch('/config'));
    expect({
      isApiError: error instanceof ApiError,
      status: error.status,
      message: error.message,
    }).toEqual({
      isApiError: true,
      status: 0,
      message: 'An unexpected error occurred: could not reach the server',
    });
  });
});
