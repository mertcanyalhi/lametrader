import { SymbolType } from '@lametrader/core';
import { Badge } from '@radix-ui/themes';
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
