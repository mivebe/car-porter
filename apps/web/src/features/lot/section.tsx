import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface SectionProps {
  icon: LucideIcon;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  testId?: string;
}

export function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-base font-semibold tabular-nums" data-testid={testId}>
        {value}
      </div>
    </div>
  );
}

export function Section({ icon: Icon, title, actions, children, testId }: SectionProps) {
  return (
    <section className="grid gap-3" data-testid={testId}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="size-4 text-muted-foreground" />
          {title}
        </h3>
        {actions}
      </div>
      {children}
    </section>
  );
}
