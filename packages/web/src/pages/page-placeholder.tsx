import type { ReactNode } from 'react';

/**
 * Empty-card placeholder shown by each of the boilerplate's three pages until
 * the follow-up issues fill in real content. Renders the page's title inside
 * a card so the route is obviously identifiable to a reviewer.
 */
export function PagePlaceholder({
  title,
  description,
}: {
  /** The heading rendered at the top of the card. */
  title: string;
  /** A short sentence stating what this page will hold once implemented. */
  description: string;
}): ReactNode {
  return (
    <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </section>
  );
}
