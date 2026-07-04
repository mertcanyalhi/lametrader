import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge a sequence of class-name expressions, then resolve any Tailwind class
 * conflicts (e.g. `'p-2 p-4'` → `'p-4'`). The standard utility used by every
 * `src/components/ui/*` primitive to compose the base class with caller-provided
 * `className` overrides.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
