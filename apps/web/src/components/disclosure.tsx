import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

interface DisclosureProps extends Omit<ComponentProps<'button'>, 'type' | 'onClick'> {
  expanded: boolean;
  onToggle: () => void;
}

/** A small chevron toggle that shows or hides the list below it. */
export function Disclosure({ expanded, onToggle, className, children, ...props }: DisclosureProps) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      className={cn(
        'flex items-center gap-1 justify-self-start text-xs font-medium text-muted-foreground hover:text-foreground',
        className,
      )}
      {...props}
    >
      {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
      {children}
    </button>
  );
}
