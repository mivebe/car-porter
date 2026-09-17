import { cn } from '@/lib/utils';

/** A car coming down under a parachute. Uses the brand colour; wheel gaps cut out to the page background. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden className={cn('text-brand', className)}>
      <path
        d="M5 17C7 6 41 6 43 17 40 15 37 15 34.5 17.5 32 15.2 28 15 24 17.5 20 15 16 15.2 13.5 17.5 11 15 8 15 5 17Z"
        fill="currentColor"
      />
      <path
        d="M6 18 24 27.5M24 18.5V27.5M42 18 24 27.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity=".75"
      />
      <path d="M24 27.5 20.5 30M24 27.5 27.5 30" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path
        d="M11 39.5V36.2c0-1 .7-1.8 1.7-2l4.1-.7 3.4-4.1c.4-.5 1-.8 1.6-.8h6.9c.6 0 1.2.3 1.6.8l3.4 4.1 4.1.7c1 .2 1.7 1 1.7 2v3.3Z"
        fill="currentColor"
      />
      <circle cx="17.5" cy="39.5" r="3.3" fill="currentColor" stroke="var(--background)" strokeWidth="1.6" />
      <circle cx="30.5" cy="39.5" r="3.3" fill="currentColor" stroke="var(--background)" strokeWidth="1.6" />
    </svg>
  );
}
