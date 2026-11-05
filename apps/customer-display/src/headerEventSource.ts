// headerEventSource.ts — a Server-Sent-Events stream read with fetch(), so the display's DEVICE credential travels in a
// header (23-inch spec §12) instead of the stream's address. The browser's EventSource cannot send headers, which is why
// the token used to ride `?deviceToken=` — where proxies, server logs and browser history keep it.
//
// It implements exactly what the shared realtime client uses from an EventSource — onopen, onmessage, onerror, close() —
// and nothing more: the realtime client owns reconnection (jittered backoff, resync on reopen), so this never retries on
// its own. A stream that ends, fails or answers with an error status calls onerror once and is finished.

type Handler<T> = ((ev: T) => void) | null;

export class HeaderEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readyState = HeaderEventSource.CONNECTING;
  onopen: Handler<Event> = null;
  onmessage: Handler<MessageEvent> = null;
  onerror: Handler<Event> = null;
  private readonly ctrl = new AbortController();

  constructor(readonly url: string, private readonly headers: Record<string, string>, private readonly fetchImpl: typeof fetch = (...a) => fetch(...a)) {
    void this.run();
  }

  close(): void {
    this.readyState = HeaderEventSource.CLOSED;
    this.ctrl.abort();
  }

  private fail(): void {
    if (this.readyState === HeaderEventSource.CLOSED) return;
    this.readyState = HeaderEventSource.CLOSED;
    this.ctrl.abort();
    try { this.onerror?.(new Event('error')); } catch { /* the handler's own problem */ }
  }

  private async run(): Promise<void> {
    try {
      const res = await this.fetchImpl(this.url, { headers: { Accept: 'text/event-stream', ...this.headers }, cache: 'no-store', signal: this.ctrl.signal });
      if (this.readyState === HeaderEventSource.CLOSED) return;
      if (!res.ok || !res.body) { this.fail(); return; }
      this.readyState = HeaderEventSource.OPEN;
      try { this.onopen?.(new Event('open')); } catch { /* handler */ }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // one event per blank line (LF or CRLF)
        for (let m = /\r?\n\r?\n/.exec(buf); m; m = /\r?\n\r?\n/.exec(buf)) {
          const block = buf.slice(0, m.index);
          buf = buf.slice(m.index + m[0].length);
          this.dispatch(block);
        }
      }
      this.fail();   // the server ended the stream: the realtime client reconnects
    } catch {
      this.fail();   // aborted by close() is already CLOSED and stays silent
    }
  }

  /** The SSE wire format: `data:` lines (joined by newlines), `id:`, comments (`:`) ignored. Named events are not used. */
  private dispatch(block: string): void {
    const data: string[] = [];
    let lastEventId = '';
    for (const line of block.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue;
      const c = line.indexOf(':');
      const field = c < 0 ? line : line.slice(0, c);
      let v = c < 0 ? '' : line.slice(c + 1);
      if (v.startsWith(' ')) v = v.slice(1);
      if (field === 'data') data.push(v);
      else if (field === 'id') lastEventId = v;
    }
    if (!data.length || this.readyState !== HeaderEventSource.OPEN) return;
    try { this.onmessage?.(new MessageEvent('message', { data: data.join('\n'), lastEventId })); } catch { /* handler */ }
  }
}
