import { Card, Heading, Text } from '@radix-ui/themes';
import type { ReactNode } from 'react';

/**
 * The `/rules` route component.
 *
 * Currently a placeholder shell: the profile picker, list table, editor
 * modal, and events modal land in later sub-issues (#162–#176). The empty
 * state below makes the route navigable so the nav entry and routing wiring
 * can be reviewed independently.
 */
export function RulesPage(): ReactNode {
  return (
    <Card>
      <div className="flex flex-col gap-3 p-2">
        <Heading size="5">Rules</Heading>
        <Text size="2" color="gray">
          Rule list, editor, and events views land here. The page is a shell until the rest of the
          milestone E sub-issues ship.
        </Text>
      </div>
    </Card>
  );
}
