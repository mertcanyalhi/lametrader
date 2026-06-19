import type {
  IndicatorDefinition,
  IndicatorInstance,
  IndicatorStatePoint,
  Profile,
} from '@lametrader/core';
import { Flex, IconButton } from '@radix-ui/themes';
import { Eye, EyeOff, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { DetachIndicatorDialog } from './detach-indicator-dialog.js';

/**
 * One row's worth of data fed to the legend. Carries the raw state series so
 * the row can render the value at the hovered time without re-querying.
 */
export interface LegendOverlay {
  /** The attached profile instance (drives the summary string). */
  instance: IndicatorInstance;
  /** The indicator's definition (drives which state field to display, plus the fallback label). */
  definition: IndicatorDefinition;
  /** Palette colour assigned to the overlay — matches the canvas series. */
  color: string;
  /** Whether the overlay is currently shown on the canvas. */
  visible: boolean;
  /** The computed state series (may be empty while pending). */
  state: IndicatorStatePoint[];
}

/**
 * The chart's per-overlay legend. Renders inside the top-left overlay column
 * (under the OHLCV), one row per applicable instance: coloured swatch + the
 * instance's `summary` (e.g. `"SMA 14 close"`), the crosshair value, a
 * show/hide eye, and a remove `x` that opens the existing
 * `DetachIndicatorDialog` confirm flow.
 *
 * The `visible` state is owned by the parent (chart page) so the canvas can
 * mirror it via the overlay prop; this component just dispatches the toggle.
 *
 * `profile` is `null` only while no profile is selected — the legend then
 * renders nothing rather than rows the user can't act on.
 */
export function IndicatorLegend({
  overlays,
  hoveredTime,
  onToggleVisible,
  profile,
}: {
  overlays: LegendOverlay[];
  hoveredTime: number | null;
  onToggleVisible: (instanceId: string) => void;
  profile: Profile | null;
}): ReactNode {
  const [toDetach, setToDetach] = useState<{
    instance: IndicatorInstance;
    definitionName: string;
  } | null>(null);

  if (profile === null || overlays.length === 0) return null;

  return (
    <>
      <Flex asChild direction="column" gap="0">
        <ul aria-label="Chart indicator overlays">
          {overlays.map((overlay) => (
            <LegendRow
              key={overlay.instance.id}
              overlay={overlay}
              hoveredTime={hoveredTime}
              onToggleVisible={onToggleVisible}
              onRemove={() =>
                setToDetach({
                  instance: overlay.instance,
                  definitionName: overlay.definition.name,
                })
              }
            />
          ))}
        </ul>
      </Flex>
      {toDetach !== null ? (
        <DetachIndicatorDialog
          profile={profile}
          instance={toDetach.instance}
          definitionName={toDetach.definitionName}
          onOpenChange={(next) => {
            if (!next) setToDetach(null);
          }}
          onDetached={() => setToDetach(null)}
        />
      ) : null}
    </>
  );
}

/**
 * Render the value to show in the row: the state row at the hovered time when
 * one is set, the latest non-null row otherwise. Numbers render with two
 * decimals; enum values render verbatim.
 */
function displayValue(overlay: LegendOverlay, hoveredTime: number | null): string {
  const stateKey = overlay.definition.state[0]?.key;
  if (!stateKey) return '';
  const row =
    hoveredTime !== null
      ? overlay.state.find((point) => point.time === hoveredTime)
      : [...overlay.state].reverse().find((point) => point[stateKey] !== null);
  if (!row) return '';
  const value = (row as Record<string, unknown>)[stateKey];
  if (typeof value === 'number') return value.toFixed(2);
  if (typeof value === 'string') return value;
  return '';
}

/** One legend row: swatch + summary + value + eye + x, on a single line. */
function LegendRow({
  overlay,
  hoveredTime,
  onToggleVisible,
  onRemove,
}: {
  overlay: LegendOverlay;
  hoveredTime: number | null;
  onToggleVisible: (instanceId: string) => void;
  onRemove: () => void;
}): ReactNode {
  // `summary` is the primary label; fall back to the definition's name when an
  // indicator doesn't declare one. `instance.label` (custom alias) wins over
  // both if ever set — no UI exposes that today, but the field is reserved.
  const label = overlay.instance.label ?? overlay.instance.summary ?? overlay.definition.name;
  const value = displayValue(overlay, hoveredTime);
  const visibilityLabel = overlay.visible ? 'Hide overlay' : 'Show overlay';

  return (
    <li aria-label={label}>
      {/* Same typographic stack as the OHLCV row above — `text-xs` + `tabular-nums`,
          default sans inherited (no font-mono), neutral foreground colour. The
          swatch is the only per-overlay colour cue. */}
      <Flex align="center" gap="2" className="text-xs tabular-nums text-[var(--gray-12)]">
        <span
          data-testid="overlay-swatch"
          aria-hidden="true"
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: overlay.color }}
        />
        <span>{label}</span>
        {value !== '' ? <span>{value}</span> : null}
        <IconButton
          type="button"
          variant="ghost"
          color="gray"
          size="1"
          aria-label={visibilityLabel}
          onClick={() => onToggleVisible(overlay.instance.id)}
        >
          {overlay.visible ? (
            <Eye size={12} aria-hidden="true" />
          ) : (
            <EyeOff size={12} aria-hidden="true" />
          )}
        </IconButton>
        <IconButton
          type="button"
          variant="ghost"
          color="gray"
          size="1"
          aria-label="Remove overlay"
          onClick={onRemove}
        >
          <X size={12} aria-hidden="true" />
        </IconButton>
      </Flex>
    </li>
  );
}
