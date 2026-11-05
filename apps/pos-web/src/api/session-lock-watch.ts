// session-lock-watch.ts — Functional Decision 35, client half of the server-side lock. When ANY request comes back
// 423 SESSION_LOCKED (the server idle-locked this session, or another tab locked it), every listening screen locks and
// shows the PIN pad. Installed once in main.tsx, wrapping fetch so every API client is covered.
// Oct 12 2026: the event carries the server's lock time (the 423 body's lockedAt) so the 8 hours count from the server's lock.
export const SESSION_LOCKED_EVENT = 'aps:session-locked';

export function installSessionLockWatch(win: Window & typeof globalThis = window): () => void {
  const original = win.fetch.bind(win);
  win.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await original(input as any, init);
    if (res.status === 423) {
      // read a COPY of the body — the caller still reads the response itself
      void res.clone().json().catch(() => null).then((b: any) => {
        win.dispatchEvent(new CustomEvent(SESSION_LOCKED_EVENT, { detail: { lockedAt: typeof b?.lockedAt === 'string' ? b.lockedAt : null } }));
      });
    }
    return res;
  }) as typeof fetch;
  return () => { win.fetch = original as typeof fetch; };
}
