// egress-policy.ts — Security Deep Scan §93 (Nov 5 2026): a process-wide egress allowlist for the API and the worker.
//
// Every outbound HTTP(S) call the process makes — global fetch, node:https / node:http request + get (which the AWS SDK,
// provider SDKs and our own clients use) — has its host checked against ONE list:
//   • the approved provider domains (EGRESS_PROVIDER_SUFFIXES: Twilio, CardPointe / CardConnect / Clover / Fiserv,
//     SendGrid, Apple push, Google / Firebase, AWS S3, Cloudflare R2, Retell, OpenAI, Anthropic …);
//   • every host named by a configured *_URL / *_ENDPOINT / *_BASE_URL / *_HOST variable (configured = approved);
//   • EGRESS_ALLOWLIST (comma-separated hosts or ".suffix" entries) for anything else the operator approves;
//   • loopback and Railway private networking (*.railway.internal) — internal services.
// A URL a tenant / owner / Super Admin typed (webhooks, integrations) goes ONLY through safeOutboundRequest, which has its
// own SSRF guard; it runs inside `egressExempt` and is not judged by this list.
//
// Modes (EGRESS_POLICY): `report` (default) — the call proceeds and the first call to each unlisted host is logged once
// and counted; `enforce` — the call is refused before any connection (EGRESS_BLOCKED); `off` — nothing is installed.
// Network-level egress control is the host's (Railway offers none) — that half stays BLOCKED_EXTERNAL.
import { AsyncLocalStorage } from 'node:async_hooks';
// default imports: the REAL module objects (a namespace import is a frozen copy — patching it would change nothing)
import http from 'node:http';
import https from 'node:https';

export type EgressMode = 'off' | 'report' | 'enforce';
export const EGRESS_PROVIDER_SUFFIXES: readonly string[] = [
  'twilio.com', 'cardconnect.com', 'cardpointe.com', 'clover.com', 'fiserv.com', 'fiservapps.com', 'sendgrid.com', 'sendgrid.net',
  'push.apple.com', 'googleapis.com', 'google.com', 'firebaseio.com', 'amazonaws.com', 'r2.cloudflarestorage.com',
  'retellai.com', 'openai.com', 'anthropic.com', 'sentry.io',
];
const INTERNAL_SUFFIXES = ['railway.internal'];
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export interface EgressPolicy { mode: EgressMode; hosts: ReadonlySet<string>; suffixes: readonly string[] }

const hostOf = (v: string): string | null => {
  try { const u = new URL(v.includes('://') ? v : `https://${v}`); return u.hostname.toLowerCase().replace(/^\[|\]$/g, '') || null; } catch { return null; }
};

/** The policy from an environment (pure). Unknown EGRESS_POLICY values fall back to `report` — never to `off`. */
export function egressPolicyFromEnv(env: Record<string, string | undefined>): EgressPolicy {
  const raw = String(env.EGRESS_POLICY ?? '').trim().toLowerCase();
  const mode: EgressMode = raw === 'off' || raw === 'enforce' ? raw : 'report';
  const hosts = new Set<string>(); const suffixes = [...EGRESS_PROVIDER_SUFFIXES, ...INTERNAL_SUFFIXES];
  for (const [k, v] of Object.entries(env)) {
    if (!v || !/(_URL|_ENDPOINT|_BASE_URL|_HOST)$/.test(k)) continue;
    // a connection string to a database / cache is not HTTP egress, but its host is still a configured destination
    for (const part of v.split(',')) { const h = hostOf(part.trim()); if (h) hosts.add(h); }
  }
  for (const e of String(env.EGRESS_ALLOWLIST ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)) {
    if (e.startsWith('.')) suffixes.push(e.slice(1)); else { const h = hostOf(e); if (h) hosts.add(h); }
  }
  return { mode, hosts, suffixes };
}

/** Is a host an approved destination? (pure) */
export function isEgressAllowed(host: string | null | undefined, p: Pick<EgressPolicy, 'hosts' | 'suffixes'>): boolean {
  const h = String(host ?? '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h) return false;
  if (LOOPBACK.has(h)) return true;
  if (p.hosts.has(h)) return true;
  return p.suffixes.some((s) => h === s || h.endsWith(`.${s}`));
}

/** User-typed URLs (safeOutboundRequest) run inside this — their own SSRF guard judges them, not the provider list. */
export const egressExempt = new AsyncLocalStorage<true>();

export class EgressBlockedError extends Error {
  readonly code = 'EGRESS_BLOCKED';
  constructor(readonly host: string) { super(`Outbound request to ${host} refused: not on the egress allowlist (EGRESS_ALLOWLIST).`); this.name = 'EgressBlockedError'; }
}

const unlisted = new Map<string, { count: number; firstAt: string }>();
/** Hosts called that are not on the list (report mode), with counts — for System Operations / the security report. */
export function egressReport(): Array<{ host: string; count: number; firstAt: string }> {
  return [...unlisted.entries()].map(([host, v]) => ({ host, ...v })).sort((a, b) => b.count - a.count);
}

let installed: { policy: EgressPolicy; restore: () => void } | null = null;

/** The host a node:http(s) request call targets, from (url | options[, options]). */
function requestHost(args: unknown[]): string | null {
  const a = args[0] as string | URL | { hostname?: string | null; host?: string | null } | null | undefined;
  if (typeof a === 'string') return hostOf(a);
  if (a instanceof URL) return a.hostname.toLowerCase();
  if (a && typeof a === 'object') return String(a.hostname ?? a.host ?? 'localhost').toLowerCase().replace(/:\d+$/, '');
  return null;
}

/**
 * Install the policy on this process (idempotent; returns the active policy). `log` receives one line per newly seen
 * unlisted host. Call it once at boot, before any client is created.
 */
export function installEgressPolicy(env: Record<string, string | undefined>, log: (msg: string) => void = (m) => console.warn(m)): EgressPolicy {
  if (installed) return installed.policy;
  const policy = egressPolicyFromEnv(env);
  if (policy.mode === 'off') { installed = { policy, restore: () => undefined }; return policy; }
  const judge = (host: string | null): void => {
    if (egressExempt.getStore()) return;
    if (host && isEgressAllowed(host, policy)) return;
    const h = host ?? '(unknown host)';
    const seen = unlisted.get(h);
    if (seen) seen.count++; else { unlisted.set(h, { count: 1, firstAt: new Date().toISOString() }); log(`[egress] ${policy.mode === 'enforce' ? 'REFUSED' : 'unlisted'} outbound host ${h} (EGRESS_POLICY=${policy.mode}; approve it with EGRESS_ALLOWLIST)`); }
    if (policy.mode === 'enforce') throw new EgressBlockedError(h);
  };
  const orig = { httpReq: http.request, httpGet: http.get, httpsReq: https.request, httpsGet: https.get, fetch: globalThis.fetch };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrap = <F extends (...a: any[]) => unknown>(fn: F): F => (function (this: unknown, ...args: unknown[]) { judge(requestHost(args)); return fn.apply(this, args); }) as unknown as F;
  const H = http as unknown as Record<string, unknown>, S = https as unknown as Record<string, unknown>;
  H.request = wrap(orig.httpReq); H.get = wrap(orig.httpGet);
  S.request = wrap(orig.httpsReq); S.get = wrap(orig.httpsGet);
  if (typeof orig.fetch === 'function') {
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as { url?: string })?.url;
      judge(hostOf(String(url ?? '')));   // throws (→ rejected promise) in enforce mode
      return orig.fetch(input, init);
    }) as typeof fetch;
  }
  installed = {
    policy,
    restore: () => {
      H.request = orig.httpReq; H.get = orig.httpGet; S.request = orig.httpsReq; S.get = orig.httpsGet;
      if (orig.fetch) globalThis.fetch = orig.fetch;
    },
  };
  return policy;
}
/** Tests only: undo installEgressPolicy. */
export function uninstallEgressPolicyForTests(): void { installed?.restore(); installed = null; unlisted.clear(); }
