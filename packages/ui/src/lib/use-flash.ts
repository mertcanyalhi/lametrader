import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from './prefers-reduced-motion.js';

/** How long a price flash stays lit before clearing, in milliseconds. */
export const FLASH_DURATION_MS = 400;

/** The direction a value moved on its last change: `'up'` rose, `'down'` fell. */
export type FlashDirection = 'up' | 'down';

/**
 * Track the direction `value` last moved and surface it briefly as a flash cue —
 * `'up'` when it rose vs. the previous render, `'down'` when it fell — clearing
 * back to `null` after {@link FLASH_DURATION_MS}. The first observed value (and a
 * `null` value) never flashes, and nothing flashes under
 * {@link prefersReducedMotion}.
 *
 * @param value - the number to watch (e.g. a live price), or `null` when absent.
 * @param durationMs - how long the flash stays lit; defaults to {@link FLASH_DURATION_MS}.
 */
export function useFlash(
  value: number | null,
  durationMs = FLASH_DURATION_MS,
): FlashDirection | null {
  const [direction, setDirection] = useState<FlashDirection | null>(null);
  const previous = useRef<number | null>(value);

  useEffect(() => {
    const prior = previous.current;
    previous.current = value;
    if (value === null || prior === null || value === prior || prefersReducedMotion()) return;
    setDirection(value > prior ? 'up' : 'down');
    const timer = setTimeout(() => setDirection(null), durationMs);
    return () => clearTimeout(timer);
  }, [value, durationMs]);

  return direction;
}
