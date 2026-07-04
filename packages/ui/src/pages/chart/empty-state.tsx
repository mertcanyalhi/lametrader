import type { Period } from '@lametrader/core';
import { Button, Card, Flex, Heading, Text } from '@radix-ui/themes';
import { type ReactNode, useState } from 'react';
import { BackfillDialog } from '../watchlist/backfill-dialog.js';

/**
 * Shown when the selected symbol/period has no stored candles: an explicit card
 * with a "Run backfill" action that opens the per-symbol backfill dialog (the
 * same flow as the watchlist row), so the user can fetch history without leaving
 * the chart.
 *
 * @param id - the symbol to backfill.
 * @param periods - the symbol's watched periods (the backfill dialog's options).
 */
export function ChartEmptyState({ id, periods }: { id: string; periods: Period[] }): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <Flex direction="column" align="center" gap="3" p="6">
        <Heading size="4">No candles yet</Heading>
        <Text size="2" color="gray" align="center">
          There's no stored history for this symbol and period. Run a backfill to fetch it.
        </Text>
        <Button onClick={() => setOpen(true)}>Run backfill</Button>
      </Flex>
      <BackfillDialog id={id} periods={periods} open={open} onOpenChange={setOpen} />
    </Card>
  );
}
