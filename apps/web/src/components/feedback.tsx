import { AlertTriangle, Loader2, type LucideIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Tone = 'muted' | 'destructive';

interface EmptyStateProps extends Omit<ComponentProps<'div'>, 'children'> {
  icon?: LucideIcon;
  tone?: Tone;
  /** Dashed frame with padding; off where the container already frames it. */
  framed?: boolean;
  children: ReactNode;
}

/** A page-level empty or failed state: a large icon over a short message. */
export function EmptyState({ icon, tone = 'muted', framed = true, className, children, ...props }: EmptyStateProps) {
  const Icon = icon ?? (tone === 'destructive' ? AlertTriangle : undefined);
  return (
    <div
      role={tone === 'destructive' ? 'alert' : undefined}
      className={cn(
        'flex flex-col items-center justify-center gap-3 text-center',
        framed && 'rounded-lg border border-dashed py-16',
        tone === 'destructive' ? 'border-destructive/40 text-destructive' : 'text-muted-foreground',
        className,
      )}
      {...props}
    >
      {Icon && <Icon className="size-10" />}
      <p className="max-w-md text-sm">{children}</p>
    </div>
  );
}

interface InlineMessageProps extends Omit<ComponentProps<'p'>, 'children'> {
  /** busy: a spinner (work in progress); destructive: a warning icon (a failure). */
  tone: Tone | 'busy';
  children: ReactNode;
}

/** A one-line status inside a section: work in progress, a failure or a note. */
export function InlineMessage({ tone, className, children, ...props }: InlineMessageProps) {
  return (
    <p
      role={tone === 'destructive' ? 'alert' : tone === 'busy' ? 'status' : undefined}
      className={cn(
        'flex items-center gap-2 text-sm',
        tone === 'destructive' ? 'text-destructive' : 'text-muted-foreground',
        className,
      )}
      {...props}
    >
      {tone === 'busy' && <Loader2 className="size-4 shrink-0 animate-spin" />}
      {tone === 'destructive' && <AlertTriangle className="size-4 shrink-0" />}
      <span>{children}</span>
    </p>
  );
}
