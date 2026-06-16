import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import {
  type ComponentPropsWithoutRef,
  type ElementRef,
  type ReactNode,
  forwardRef,
} from 'react';
import { cn } from '../../lib/cn.js';

/**
 * Root provider — wraps the app once so descendant tooltips share a single
 * delay-duration timeline.
 */
export const TooltipProvider = TooltipPrimitive.Provider;

/**
 * Tooltip root (state container).
 */
export const Tooltip = TooltipPrimitive.Root;

/**
 * Trigger — wrap whatever element should show the tooltip on hover/focus.
 */
export const TooltipTrigger = TooltipPrimitive.Trigger;

/**
 * Floating tooltip content with project styling. Wraps Radix's `Content` plus
 * `Portal` so positioning is handled outside the local stacking context.
 */
export const TooltipContent = forwardRef<
  ElementRef<typeof TooltipPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(function TooltipContent({ className, sideOffset = 6, children, ...rest }, ref) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          'z-50 overflow-hidden rounded-md border border-border bg-popover px-2.5 py-1.5 ' +
            'text-xs text-popover-foreground shadow-md',
          className,
        )}
        {...rest}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
});

/**
 * Convenience wrapper — show {@link content} when hovering {@link children}.
 * Uses the existing surrounding {@link TooltipProvider}.
 */
export function SimpleTooltip({
  children,
  content,
}: {
  /** The element that triggers the tooltip. */
  children: ReactNode;
  /** The text shown inside the tooltip. */
  content: ReactNode;
}): ReactNode {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{content}</TooltipContent>
    </Tooltip>
  );
}
