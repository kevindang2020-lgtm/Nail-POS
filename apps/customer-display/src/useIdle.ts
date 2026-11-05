// useIdle.ts — 23-inch spec §7: "after configurable inactivity … the display may transition into full-screen advertising.
// Any customer touch immediately returns." True once nothing touched the screen for `timeoutMs`; any touch, key or wheel
// resets it. `timeoutMs = null` switches it off (and it is never idle while off).
import { useEffect, useRef, useState } from 'react';

const EVENTS = ['pointerdown', 'touchstart', 'keydown', 'wheel'] as const;

export function useIdle(timeoutMs: number | null): boolean {
  const [idle, setIdle] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(timer.current);
    setIdle(false);
    if (timeoutMs == null || !(timeoutMs > 0)) return;
    const arm = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setIdle(true), timeoutMs); };
    const activity = () => { setIdle(false); arm(); };
    arm();
    for (const e of EVENTS) window.addEventListener(e, activity, { capture: true, passive: true });
    return () => {
      clearTimeout(timer.current);
      for (const e of EVENTS) window.removeEventListener(e, activity, { capture: true });
    };
  }, [timeoutMs]);
  return timeoutMs != null && idle;
}
