import type {
  IndicatorDefinition,
  IndicatorInstance,
  IndicatorStatePoint,
  Profile,
} from '@lametrader/core';
import { Flex, IconButton, Text } from '@radix-ui/themes';
import { Eye, EyeOff, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { DetachIndicatorDialog } from './detach-indicator-dialog.js';

/**
 * One row's worth of data fed to the legend. Carries the raw state series so
 * the row can render the value at the hovered time without re-querying.
 */
export interface LegendOverlay {
  /** The attached profile instance (drives the display name + summary). */
  instance: IndicatorInstance;
  /** The indicator's definition (drives which state field to display). */
  definition: IndicatorDefinition;
  /** Palette colour assigned to the overlay — matches the canvas series. */
  color: string;
  /** Whether the overlay is currently shown on the canvas. */
  visible: boolean;
  /** The computed state series (may be empty while pending). */
  state: IndicatorStatePoint[];
}

/**
 * The chart's per-overlay legend. One row per applicable instance, showing the
 * coloured swatch, display name + summary, the crosshair value (or latest when
 * no crosshair), a show/hide eye, and a remove `x` that opens the existing
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
      <Flex
        asChild
        gap="3"
        wrap="wrap"
        align="center"
        className="border-t border-[var(--gray-a5)] pt-2"
      >
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

/** One legend row — keyed by instance id; the parent owns the layout container. */
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
  const displayName = overlay.instance.label ?? overlay.definition.name;
  const value = displayValue(overlay, hoveredTime);
  const visibilityLabel = overlay.visible ? 'Hide overlay' : 'Show overlay';

  return (
    <li aria-label={displayName}>
      <Flex align="center" gap="2">
        <span
          data-testid="overlay-swatch"
          aria-hidden="true"
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: overlay.color }}
        />
        <Flex direction="column" className="leading-tight">
          <Text size="2">{displayName}</Text>
          {overlay.instance.summary ? (
            <Text size="1" color="gray" className="font-mono">
              {overlay.instance.summary}
            </Text>
          ) : null}
        </Flex>
        {value !== '' ? (
          <Text size="2" className="font-mono tabular-nums">
            {value}
          </Text>
        ) : null}
        <IconButton
          type="button"
          variant="ghost"
          color="gray"
          aria-label={visibilityLabel}
          onClick={() => onToggleVisible(overlay.instance.id)}
        >
          {overlay.visible ? (
            <Eye size={14} aria-hidden="true" />
          ) : (
            <EyeOff size={14} aria-hidden="true" />
          )}
        </IconButton>
        <IconButton
          type="button"
          variant="ghost"
          color="gray"
          aria-label="Remove overlay"
          onClick={onRemove}
        >
          <X size={14} aria-hidden="true" />
        </IconButton>
      </Flex>
    </li>
  );
}
