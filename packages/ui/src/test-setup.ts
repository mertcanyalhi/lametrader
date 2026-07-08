/**
 * Vitest setup for the web package.
 *
 * Loaded automatically for the unit project (see root `vitest.config.ts`).
 * Adds polyfills that jsdom doesn't ship so Radix-based components can
 * render in component tests. Each polyfill is guarded with a `typeof` check
 * so the file is a no-op in non-jsdom test environments.
 */

/**
 * React 19 honours `IS_REACT_ACT_ENVIRONMENT` to know it's inside a test
 * harness — without it, state updates batch differently and userEvent /
 * `useEffect` flushes lag the assertions. Setting it here is the standard
 * RTL + React 19 + Vitest contract.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Radix Themes' internal `ScrollArea` (used inside `Select`'s dropdown) reads
 * `ResizeObserver`. jsdom does not implement it. A no-op stand-in lets Radix
 * mount without affecting test assertions.
 */
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {
      /* no-op */
    }
    unobserve(): void {
      /* no-op */
    }
    disconnect(): void {
      /* no-op */
    }
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

/**
 * jsdom does not implement `HTMLCanvasElement.getContext`, so it returns `null`.
 * `lightweight-charts` tolerates that during its initial render but not in the
 * `requestAnimationFrame` draw it schedules: after a chart's container unmounts,
 * a pending frame runs `PriceAxisWidget._optimalWidth`, which `ensureNotNull`s
 * the 2d context and throws `Error: Value is null`. That async throw escapes the
 * test that rendered the chart and Vitest counts it as an unhandled error,
 * failing the whole run. A permissive 2d-context stub (no-op drawing ops,
 * zero-width text measurement) keeps the frame from throwing.
 */
if (typeof HTMLCanvasElement !== 'undefined') {
  const stub2dContext = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'measureText') return () => ({ width: 0 });
        if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
          return () => ({ addColorStop: (): void => undefined });
        }
        if (prop === 'canvas') return undefined;
        // Every drawing/state method is a no-op; property reads return the same
        // callable, which is harmless for the paths the chart exercises here.
        return (): void => undefined;
      },
    },
  );
  HTMLCanvasElement.prototype.getContext = (() =>
    stub2dContext) as unknown as HTMLCanvasElement['getContext'];
}

/**
 * Radix Themes uses `Element.hasPointerCapture` / `scrollIntoView` while
 * managing focus inside `Select` and other floating components. jsdom omits
 * both; we stub them so triggering them via `userEvent.click` is a no-op.
 */
if (typeof window !== 'undefined') {
  if (typeof Element.prototype.hasPointerCapture !== 'function') {
    Element.prototype.hasPointerCapture = (): boolean => false;
  }
  if (typeof Element.prototype.releasePointerCapture !== 'function') {
    Element.prototype.releasePointerCapture = (): void => undefined;
  }
  if (typeof Element.prototype.scrollIntoView !== 'function') {
    Element.prototype.scrollIntoView = (): void => undefined;
  }
}
