import { useEffect, useRef } from 'react';

// Close-on-Escape for modals/sheets. `active` is the open state; only subscribes while open. Keeps the close handler in
// a ref so it never needs to be memoized at the call site. A small keyboard-accessibility win for dialog overlays.
export function useEscapeKey(active: boolean, onEscape: () => void) {
  const ref = useRef(onEscape);
  ref.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') ref.current(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active]);
}
