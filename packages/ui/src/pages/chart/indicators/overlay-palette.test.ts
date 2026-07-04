import { describe, expect, it } from 'vitest';
import { Theme } from '../../../lib/theme.types.js';
import { paletteColor } from './overlay-palette.js';

/**
 * The palette is deterministic — the chart's series-creation effect calls it
 * keyed by an instance's index in the applicable list, so re-renders must hand
 * back the same colour for the same `(index, theme)` pair.
 *
 * It's also theme-distinct — different palettes for light and dark, so the
 * series re-colours when the chart is re-created on a theme switch.
 */
describe('paletteColor', () => {
  it('returns deterministic, theme-distinct colours per (index, theme)', () => {
    const light0a = paletteColor(0, Theme.Light);
    const light0b = paletteColor(0, Theme.Light);
    const dark0 = paletteColor(0, Theme.Dark);

    expect({
      lightDeterministic: light0a === light0b,
      themeDistinct: light0a !== dark0,
      // Both branches return a non-empty string so the chart can pass it to
      // `lightColor` / `setMarkers({ color })` directly.
      lightShape: typeof light0a === 'string' && light0a.length > 0,
      darkShape: typeof dark0 === 'string' && dark0.length > 0,
    }).toEqual({
      lightDeterministic: true,
      themeDistinct: true,
      lightShape: true,
      darkShape: true,
    });
  });
});
