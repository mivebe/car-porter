import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** A small count of names waiting for assignment, in the brand colour (a to-do, not an error). */
export function CountBadge({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground tabular-nums',
        className,
      )}
      {...props}
    />
  );
}
