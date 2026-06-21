import type { Theme } from '../../../lib/theme.types.js';

/**
 * Light- and dark-theme palettes for indicator overlays.
 *
 * Each palette is a small, hand-picked set of perceptually-distinct hues with
 * contrast that reads cleanly against the matching chart background.
 * Indexed by the overlay's position in the chart's applicable list, so two
 * indicators on the same chart always get different colours from the first
 * pass and the colour stays stable across re-renders.
 *
 * The palettes wrap modulo length, so a chart with more overlays than entries
 * starts reusing colours rather than producing washed-out filler.
 */
const PALETTES: Record<Theme, readonly [string, ...string[]]> = {
  light: ['#1d4ed8', '#b45309', '#15803d', '#9333ea', '#be123c', '#0e7490'],
  dark: ['#3aa3ff', '#ff8c3a', '#21c55d', '#c084fc', '#fb7185', '#22d3ee'],
};

/**
 * Resolve the colour for an overlay at `index` under `theme`.
 *
 * Deterministic — the same `(index, theme)` always returns the same string.
 * Theme-distinct — the light and dark tables share no entries at the same
 * index, so a chart that re-creates on theme switch immediately re-colours
 * its overlays without per-series options patching.
 */
export function paletteColor(index: number, theme: Theme): string {
  const palette = PALETTES[theme];
  const safeIndex = ((index % palette.length) + palette.length) % palette.length;
  // `safeIndex` is always in range, but `noUncheckedIndexedAccess` types the read
  // as possibly-undefined; the first entry is a safe, non-empty-palette fallback.
  return palette[safeIndex] ?? palette[0];
}
