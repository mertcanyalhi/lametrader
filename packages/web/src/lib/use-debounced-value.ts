import { useEffect, useState } from 'react';

/**
 * Debounce a rapidly-changing value, returning the latest value only after it
 * has been stable for `delayMs`. Used to throttle the instrument-search query
 * so a request fires once the user pauses typing, not on every keystroke.
 *
 * @param value - the live value (e.g. the search box text).
 * @param delayMs - quiet period before the value settles.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
