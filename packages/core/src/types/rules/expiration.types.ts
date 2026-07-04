/**
 * A rule's expiration policy.
 *
 * `null` means the rule never expires; a value carries the epoch-ms instant
 * after which the rule should no longer fire.
 */
export type Expiration = { at: number } | null;
