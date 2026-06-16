import type { Period } from '@lametrader/core';
import { Card, Flex, Heading, Text } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import { AddSymbolDialog } from './add-symbol-dialog.js';

/**
 * The empty watchlist placeholder — shown when no symbols are watched yet. Pairs
 * a short explanation with the add-symbol flow (labelled "Watch a symbol").
 *
 * @param defaultPeriods - periods a newly-added symbol defaults to (from config).
 */
export function EmptyState({ defaultPeriods }: { defaultPeriods: Period[] }): ReactNode {
  return (
    <Card>
      <Flex direction="column" align="center" gap="3" py="7">
        <Heading as="h2" size="4">
          No symbols watched yet
        </Heading>
        <Text size="2" color="gray">
          Add an instrument to start tracking its price and indicators.
        </Text>
        <AddSymbolDialog triggerLabel="Watch a symbol" defaultPeriods={defaultPeriods} />
      </Flex>
    </Card>
  );
}
