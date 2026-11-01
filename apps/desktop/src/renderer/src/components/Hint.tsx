import type { ReactElement, ReactNode } from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/**
 * A tooltip on one element. With no `label` it shows nothing, and the element is where it was, so
 * a tooltip that comes and goes does not remount what it is on. A disabled element gets no pointer
 * events, so for one, put a `span` around it and the Hint on the span.
 */
export function Hint({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactElement;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        {label ? <TooltipContent>{label}</TooltipContent> : null}
      </Tooltip>
    </TooltipProvider>
  );
}
