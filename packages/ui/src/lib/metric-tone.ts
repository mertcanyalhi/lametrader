/**
 * A metric's Radix accent scale — the sign-derived trio (green up, red down,
 * neutral flat) plus the warm-to-cool ramp the win-rate metric grades itself on.
 * Each name is a Radix color scale, so its background is `var(--<name>-a3)`.
 */
export type MetricColor = 'grass' | 'red' | 'gray' | 'orange' | 'yellow' | 'green';

/** Map a signed number to its tone — positive green, negative red, zero neutral. */
export function signTone(value: number): MetricColor {
  if (value > 0) return 'grass';
  if (value < 0) return 'red';
  return 'gray';
}
