import type { ReactNode } from 'react';
import { PagePlaceholder } from './page-placeholder.js';

/**
 * Chart page — boilerplate placeholder. The candlestick chart, period picker,
 * profile selector, and indicator panel land in their own follow-up issues.
 */
export function ChartPage(): ReactNode {
  return (
    <PagePlaceholder
      title="Chart"
      description="The candlestick chart and indicator overlays will render here."
    />
  );
}
