import { Button, Flex, Text } from '@radix-ui/themes';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { type ReactNode, useState } from 'react';

/**
 * A collapsible option group: a ghost `<Button>` disclosure toggle titled by
 * `title`, its children mounted only while open.
 *
 * Radix Themes ships no Accordion, so this is a plain React disclosure — a Radix
 * `Button` (keyboard-accessible, `aria-expanded`-annotated) over conditionally
 * rendered children. Children render only when open rather than relying on CSS
 * collapse, so a collapsed group truly removes its fields from the tree;
 * react-hook-form keeps the unmounted fields' values (its default
 * `shouldUnregister: false`).
 *
 * @param title - the group's disclosure label, always visible on the toggle.
 * @param defaultOpen - whether the group starts expanded (default collapsed).
 * @param children - the group's content, shown only while it is open.
 */
export function CollapsibleGroup({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}): ReactNode {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <Button
        type="button"
        variant="ghost"
        color="gray"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <Text size="2" weight="medium">
          {title}
        </Text>
      </Button>
      {open ? (
        // A left accent rule + indent sets the disclosed content apart from the
        // sibling fields around the group, reading as "belongs to the toggle above".
        <Flex
          direction="column"
          gap="3"
          mt="2"
          ml="2"
          pl="3"
          className="border-[var(--gray-a5)] border-l"
        >
          {children}
        </Flex>
      ) : null}
    </div>
  );
}
