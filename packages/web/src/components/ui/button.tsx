import { type VariantProps, cva } from 'class-variance-authority';
import { type ButtonHTMLAttributes, type Ref, forwardRef } from 'react';
import { cn } from '../../lib/cn.js';

/**
 * Visual variants of the {@link Button}.
 *
 * Variants are kept narrow on purpose — additional cases are added by the
 * page issues that first need them.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium ' +
    'transition-colors focus-visible:outline-none focus-visible:ring-2 ' +
    'focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        outline:
          'border border-border bg-background hover:bg-accent hover:text-accent-foreground',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 px-3',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

/**
 * Props accepted by {@link Button} — the native `<button>` props plus the
 * variant selectors.
 */
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

/**
 * Hand-authored button primitive (shadcn/ui pattern) backed by Tailwind tokens.
 *
 * Composes `buttonVariants(...)` with caller-supplied `className`, so a caller
 * can override individual classes without losing the variant's base styles.
 *
 * @example
 *   <Button variant="ghost" size="icon" aria-label="Toggle theme"><Sun /></Button>
 */
export const Button = forwardRef(function Button(
  { className, variant, size, type = 'button', ...rest }: ButtonProps,
  ref: Ref<HTMLButtonElement>,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...rest}
    />
  );
});
