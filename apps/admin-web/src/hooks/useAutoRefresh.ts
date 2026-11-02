// useAutoRefresh.ts — background polling that reuses the app's established setInterval pattern (no extra realtime
// framework). It is paused while the browser tab is hidden, resumes immediately on refocus, aborts the prior request
// each tick, and never overlaps. Pass a `run(signal)` that performs one background refresh; it should preserve the
// last valid result on failure rather than clearing the UI (the caller owns that policy).
import { useEffect, useRef } from 'react';

export function useAutoRefresh(run: (signal: AbortSignal) => void, ms: number, enabled = true) {
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    if (!enabled || ms <= 0) return;
    let ac: AbortController | null = null;
    const tick = () => { if (document.hidden) return; ac?.abort(); ac = new AbortController(); runRef.current(ac.signal); };
    const id = setInterval(tick, ms);
    const onVis = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); ac?.abort(); };
  }, [ms, enabled]);
}
