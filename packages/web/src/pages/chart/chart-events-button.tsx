import { Button } from '@radix-ui/themes';
import { ListChecks } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { EventsDialog } from '../rules/events-dialog.js';

/**
 * The chart bottom-bar Events item — a button that opens the shared
 * {@link EventsDialog} in `symbol` mode, listing every rule event recorded
 * against the current symbol (newest-first, paginated).
 *
 * @param symbolId - the chart's current symbol id.
 */
export function ChartEventsButton({ symbolId }: { symbolId: string }): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="soft"
        color="gray"
        className="min-w-32 justify-center"
        onClick={() => setOpen(true)}
      >
        <ListChecks size={14} aria-hidden="true" />
        Events
      </Button>
      {open ? (
        <EventsDialog open={true} onOpenChange={setOpen} mode={{ kind: 'symbol', symbolId }} />
      ) : null}
    </>
  );
}
