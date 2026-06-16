import { SymbolType } from '@lametrader/core';
import { Badge, Code } from '@radix-ui/themes';
import type { ReactNode } from 'react';

/**
 * Distinct Radix accent colour per asset class, so the Type column reads at a
 * glance. Exported (and unit-tested) so the mapping is the single source of
 * truth for every place a symbol type is badged.
 */
export const SYMBOL_TYPE_COLOR: Record<SymbolType, 'orange' | 'blue' | 'purple' | 'green'> = {
  [SymbolType.Crypto]: 'orange',
  [SymbolType.Stock]: 'blue',
  [SymbolType.Fund]: 'purple',
  [SymbolType.Fx]: 'green',
};

/**
 * A soft `Badge` showing a symbol's asset type, colour-coded by {@link SYMBOL_TYPE_COLOR}.
 *
 * @param type - the asset class to badge.
 */
export function SymbolTypeBadge({ type }: { type: SymbolType }): ReactNode {
  return (
    <Badge color={SYMBOL_TYPE_COLOR[type]} variant="soft">
      {type}
    </Badge>
  );
}

/**
 * A symbol's id rendered as monospace, colour-coded by asset class via
 * {@link SYMBOL_TYPE_COLOR}. The single component for showing a symbol id —
 * the table, the search results, and the edit/remove dialogs all use it so the
 * identity reads consistently everywhere. `ghost` so it's plain coloured text
 * (no chip background that would leave a gap on short ids).
 *
 * @param id - the canonical symbol id.
 * @param type - the asset class (drives the colour).
 */
export function SymbolIdCode({ id, type }: { id: string; type: SymbolType }): ReactNode {
  return (
    <Code variant="ghost" color={SYMBOL_TYPE_COLOR[type]} className="font-mono">
      {id}
    </Code>
  );
}
