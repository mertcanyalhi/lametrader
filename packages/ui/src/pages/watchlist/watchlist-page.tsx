import { Callout, Flex, Heading, Skeleton, Table } from '@radix-ui/themes';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect } from 'react';
import { useWatchlist, WATCHLIST_QUERY_KEY } from '../../lib/hooks/symbols.js';
import { useConfig } from '../../lib/hooks/use-config.js';
import { streamClient } from '../../lib/stream/stream-client.js';
import { AddSymbolDialog } from './add-symbol-dialog.js';
import { EmptyState } from './empty-state.js';
import { WatchlistTable } from './watchlist-table.js';

/** Number of placeholder rows shown while the watchlist loads. */
const SKELETON_ROWS = 5;

/**
 * The watchlist page (`/`): a dense, sortable table of watched symbols with
 * their snapshot quotes, plus the add/edit-periods/remove management flows.
 *
 * Loads the enriched watchlist and the platform config (for default + available
 * periods), and renders the appropriate state: skeleton while loading, an error
 * callout on failure, an empty state when nothing is watched, or the table.
 */
export function WatchlistPage(): ReactNode {
  const watchlist = useWatchlist();
  const config = useConfig();
  const availablePeriods = config.data?.periods ?? [];
  const queryClient = useQueryClient();

  // After a stream reconnect the rows' live values may have drifted while the
  // socket was down, so refetch the snapshot to resync from the server.
  useEffect(
    () =>
      streamClient.onReconnect(() => {
        queryClient.invalidateQueries({ queryKey: WATCHLIST_QUERY_KEY });
      }),
    [queryClient],
  );

  return (
    <Flex direction="column" gap="4">
      <Flex justify="between" align="center">
        <Heading as="h1" size="5">
          Watchlist
        </Heading>
        {watchlist.data && watchlist.data.length > 0 ? (
          <AddSymbolDialog triggerLabel="Add symbol" defaultPeriods={availablePeriods} />
        ) : null}
      </Flex>

      {watchlist.isPending ? <WatchlistSkeleton /> : null}

      {watchlist.isError ? (
        <Callout.Root color="red" role="alert">
          <Callout.Text>{watchlist.error.message}</Callout.Text>
        </Callout.Root>
      ) : null}

      {watchlist.data && watchlist.data.length === 0 ? (
        <EmptyState defaultPeriods={availablePeriods} />
      ) : null}

      {watchlist.data && watchlist.data.length > 0 ? (
        <WatchlistTable symbols={watchlist.data} availablePeriods={availablePeriods} />
      ) : null}
    </Flex>
  );
}

/**
 * Loading placeholder rendered while the initial watchlist query is pending —
 * a header row of skeletons plus a few skeleton body rows.
 */
function WatchlistSkeleton(): ReactNode {
  return (
    <Table.Root variant="surface" size="1" data-testid="watchlist-skeleton">
      <Table.Body>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length static placeholder list
          <Table.Row key={index}>
            <Table.Cell>
              <Skeleton width="12rem" height="1.5rem" />
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}
