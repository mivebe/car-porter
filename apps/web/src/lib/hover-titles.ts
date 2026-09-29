import { useEffect } from 'react';

const CLICKABLE = 'button, [role="button"], [role="option"], [role="tab"], [role="menuitem"]';

/**
 * Gives every button a native hover tooltip: on hover, a button without its own `title`
 * gets one from its `aria-label` or visible text. Opt out with `data-no-title`.
 */
export function useHoverTitles() {
  useEffect(() => {
    const onOver = (event: PointerEvent) => {
      const el = (event.target as Element | null)?.closest?.<HTMLElement>(CLICKABLE);
      if (!el || el.closest('[data-no-title]')) return;
      if (el.hasAttribute('title') && !el.hasAttribute('data-auto-title')) return;
      const label = (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!label) return;
      el.title = label;
      el.setAttribute('data-auto-title', '');
    };
    document.addEventListener('pointerover', onOver);
    return () => document.removeEventListener('pointerover', onOver);
  }, []);
}
