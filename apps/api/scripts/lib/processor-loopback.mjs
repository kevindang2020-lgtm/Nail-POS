// processor-loopback.mjs — a PROOF-ONLY preload (node --import): answers ONE allow-listed processor host in-process by
// forwarding it to a local fake. Since Security Deep Scan D2 (Oct 23 2026) a salon's gateway base URL must be https on an
// allow-listed processor host (*.cardconnect.com …), so a live proof can no longer point the gateway at http://127.0.0.1.
// The proof registers https://<PROCESSOR_LOOPBACK_HOST>/… as the base URL (it passes the real policy) and this preload sends
// those requests to PROCESSOR_LOOPBACK_TARGET (the proof's own fake processor). Inert unless both variables are set, and
// refuses to load under NODE_ENV=production. Any other host goes to the real fetch untouched.
const HOST = process.env.PROCESSOR_LOOPBACK_HOST;
const TARGET = process.env.PROCESSOR_LOOPBACK_TARGET;
if (HOST && TARGET) {
  if (process.env.NODE_ENV === 'production') throw new Error('processor-loopback is a proof-only preload and never runs in production');
  const real = globalThis.fetch;
  const target = new URL(TARGET);
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname !== HOST) return real(input, init);
    const to = new URL(url.pathname + url.search, target);
    return real(to, init);
  };
}
