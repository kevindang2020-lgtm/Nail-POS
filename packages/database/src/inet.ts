// inet.ts — the ONE place a value becomes safe for a Postgres `INET` column.
//
// This exists because `INET` is a trap. Postgres rejects anything that isn't a valid address, and the value we
// have on hand is Express's `req.ip` — which **behind a proxy or load balancer is a comma-separated chain**
// ("1.2.3.4, 5.6.7.8"). That is not valid inet, so the INSERT throws.
//
// And every writer of these columns swallows errors on purpose (an audit write must never block a login; a
// session write must never break a sign-in). So the throw is eaten and the row is simply LOST — silently, forever.
//
// That is not hypothetical: `login_attempts.ip_address` is INET, and the login-audit sink lost every record in
// production for exactly this reason, leaving the Super Admin Security dashboard reporting zero failed logins.
//
// There are three INET columns in this schema — `login_attempts.ip_address`, `sessions.ip_address` and
// `audit_logs.ip_address` — and the `sessions` one is the nastiest: if that insert throws, the session row is
// never created, the token gets no `sid`, and the session becomes **UNREVOCABLE**. Behind a proxy that would
// silently disable session revocation platform-wide.
//
// The rule: **losing the IP is acceptable. Losing the ROW is not.**
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const IPV6 = /^[0-9a-f:]+$/i;

export function safeInet(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const first = String(raw).split(',')[0].trim();       // proxy chains: "client, proxy1, proxy2"
  if (!first) return null;
  const bare = first.replace(/^::ffff:/i, '');          // IPv4-mapped IPv6, as Node hands it to you
  if (IPV4.test(bare)) {
    return bare.split('.').every((o) => Number(o) <= 255) ? bare : null;
  }
  if (first.includes(':') && IPV6.test(first)) return first;
  return null;                                          // unparseable → drop the IP, KEEP the row
}
