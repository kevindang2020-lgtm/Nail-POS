// useViewport.ts — the screen the display is on, in CSS pixels (spec §2, §87–§88: lay out by the viewport and density,
// never by physical inches). `wide` picks the 23-inch three-column layout: landscape, at least ~5:4. A portrait tablet
// keeps the single-column layout.
import { useEffect, useState } from 'react';

export interface Viewport { w: number; h: number; dpr: number; wide: boolean }
export const WIDE_MIN_RATIO = 1.25;

const read = (): Viewport => {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1920;
  const h = typeof window !== 'undefined' ? window.innerHeight : 1080;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  return { w, h, dpr, wide: h > 0 && w / h >= WIDE_MIN_RATIO };
};

export function useViewport(): Viewport {
  const [v, setV] = useState<Viewport>(read);
  useEffect(() => {
    const on = () => setV((prev) => { const n = read(); return n.w === prev.w && n.h === prev.h && n.dpr === prev.dpr ? prev : n; });
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    return () => { window.removeEventListener('resize', on); window.removeEventListener('orientationchange', on); };
  }, []);
  return v;
}
