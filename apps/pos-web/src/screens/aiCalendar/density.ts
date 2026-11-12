// density.ts — Extras · AI Calendar 08: automatic responsive density WITHOUT shrinking fonts. The AI Calendar measures its
// own container (not the window: the sidebar and a side panel change the room the grid really has) and switches between
// spacious and compact SPACING only — gaps, paddings, column minimums. Font sizes, the four equal KPIs and every
// operation stay exactly the same; CSS for [data-density="compact"] lives next to the .aic-* calendar rules in styles.css.
import { useEffect, useState, type RefObject } from 'react';

export type AicDensity = 'spacious' | 'compact';
/** below this container width the grid uses compact spacing (a 27" POS at 100% with the sidebar open stays spacious) */
export const AIC_COMPACT_BELOW = 1280;
/** a small band so a container sitting right at the edge does not flip back and forth while it settles */
export const AIC_DENSITY_HYSTERESIS = 24;

export function calendarDensity(width: number, prev: AicDensity = 'spacious'): AicDensity {
  if (!(width > 0)) return prev;                                   // not measured (hidden / jsdom): keep what we had
  if (prev === 'compact') return width >= AIC_COMPACT_BELOW + AIC_DENSITY_HYSTERESIS ? 'spacious' : 'compact';
  return width < AIC_COMPACT_BELOW ? 'compact' : 'spacious';
}

export function useContainerDensity(ref: RefObject<HTMLElement | null>): AicDensity {
  const [density, setDensity] = useState<AicDensity>('spacious');
  useEffect(() => {
    const el = ref.current; if (!el) return;
    setDensity((p) => calendarDensity(el.getBoundingClientRect().width, p));
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => { const w = e?.contentRect.width ?? 0; setDensity((p) => calendarDensity(w, p)); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return density;
}
