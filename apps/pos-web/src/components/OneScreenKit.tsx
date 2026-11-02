// OneScreenKit.tsx — the shared parts of the one-screen POS pages (Overview, Check-In, Live Operations — Oct 28 2026
// mandates): a fixed-height Card whose body scrolls locally, a compact Empty state, "+N more" from the server's total, and
// useFitRows (how many rows fit the card at this density). Styles: the `:is(.overview-page,.check-in-page,
// .live-ops-page)` block at the end of styles.css.
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

export function Card({ title, right, children, foot, testId, className, bodyRef }: { title: string; right?: ReactNode; children: ReactNode; foot?: ReactNode; testId?: string; className?: string; bodyRef?: RefObject<HTMLDivElement> }) {
  return (
    <section className={`ov-card ${className || ''}`} data-testid={testId}>
      <div className="ov-card-h"><h3>{title}</h3>{right}</div>
      <div className="ov-card-b" ref={bodyRef}>{children}</div>
      {foot ? <div className="ov-card-f">{foot}</div> : null}
    </section>
  );
}
export function Empty({ msg }: { msg: string }) { return <div className="ov-empty">{msg}</div>; }
/**
 * §11 / §26: how many of a card's rows fit in its fixed body at THIS density (COMPACT 1920, TIGHT 1600, COMFORTABLE 2560),
 * capped at the server's top-row count. The card shows exactly that many and its "+N more" counts the rest — no row is
 * hidden behind the card's internal scroll and the card never grows. Measured before paint (useLayoutEffect) and again when
 * the card is resized, from the first row's pitch; without layout (jsdom / no ResizeObserver) it is simply `max`.
 */
export function useFitRows(max: number, dep: unknown): [RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [n, setN] = useState(max);
  // the row pitch measured when two rows were on screen — with ONE row its height alone under-estimates the pitch (gaps /
  // borders), so 1 → 2 → 1 → … could flip forever (React #185, found by the Live Operations 1600×765 run, Oct 28 2026)
  const pitchRef = useRef(0);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) { setN(max); return; }
    const fit = () => {
      const rows = el.querySelectorAll<HTMLElement>('tbody tr, li, .flow-sub-row');
      const limit = (el.closest('.ov-card-b') as HTMLElement | null) || el;
      if (rows.length === 0) { setN(max); return; }
      const a = rows[0].getBoundingClientRect();
      if (rows.length > 1) pitchRef.current = rows[1].getBoundingClientRect().top - a.top;
      const pitch = rows.length > 1 ? pitchRef.current : Math.max(a.height, pitchRef.current);
      if (!(pitch > 0) || !(a.height > 0)) { setN(max); return; }
      const bottom = limit.getBoundingClientRect().bottom - (parseFloat(getComputedStyle(limit).paddingBottom) || 0);
      setN(Math.max(1, Math.min(max, Math.floor((bottom - a.top - a.height + 0.5) / pitch) + 1)));
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit); ro.observe((el.closest('.ov-card-b') as HTMLElement | null) || el);
    return () => ro.disconnect();
  }, [max, dep, n]); // n: one more pass when the first measure had a single row (its pitch is then refined)
  return [ref, n];
}

/** "+N more" when the server's total is larger than the rows the card shows (§11–§21: counts, not taller cards) */
export function More({ shown, total }: { shown: number; total?: number }) {
  return total != null && total > shown ? <span className="ov-more-n">{tx('ops.overview.moreCount', { count: String(total - shown) })}</span> : null;
}

