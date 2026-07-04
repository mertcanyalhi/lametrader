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
