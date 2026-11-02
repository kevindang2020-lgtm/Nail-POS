// client-ip.ts — Constitution 12 §50–57: the ONE way to learn a request's client IP.
//
// WHAT WAS WRONG (found in Phase 9). Every IP-keyed control depended on how each site happened to read the address:
//   • Express's `trust proxy` was never set. Behind Railway's edge proxy, `req.ip` is the PROXY's address for every
//     request — so every per-IP limit (crash intake, realtime connections, booking verification) was one bucket
//     shared by every user on earth.
//   • The public website forms and booking verification read `X-Forwarded-For` RAW. A client sets that header itself:
//     a spam bot sending a fresh random value gets a fresh rate-limit budget on every request.
//   • The login throttle was built to key on (portal, salon, identifier, ip) — and was never GIVEN an ip. It locked
//     per account only, so anyone could lock any owner out from everywhere by failing five times. And the session's
//     recorded IP came from the request BODY, a value the client chooses.
//
// THE RULE. main.ts sets `trust proxy` to a HOP COUNT (TRUST_PROXY_HOPS; 1 in production = Railway's edge, 0
// elsewhere). With a count, Express takes the address the TRUSTED proxy appended — the rightmost untrusted entry —
// so extra entries a client prepends to X-Forwarded-For are ignored. (`trust proxy: true` would trust the LEFTMOST
// entry: exactly the value an attacker writes.) Every site calls clientIp(req); nothing reads the header itself.

/** The client address as Express resolved it under the configured hop count. Never a raw header. */
export function clientIp(req: any): string | null {
  const ip = req?.ip ?? req?.socket?.remoteAddress ?? null;
  if (!ip) return null;
  return String(ip).replace(/^::ffff:/i, '');
}
