// trust-proxy.ts — how many reverse-proxy hops Express may trust when resolving the client address (Constitution 12
// §50). Configuration derived from the environment, so it lives with @aipowersalon/config; clientIp() — the pure request
// helper that reads the address Express resolved under this setting — is @aipowersalon/security.
export function trustProxyHops(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.TRUST_PROXY_HOPS;
  if (raw !== undefined && raw !== '') { const n = Number(raw); return Number.isInteger(n) && n >= 0 && n <= 5 ? n : 0; }
  return env.NODE_ENV === 'production' ? 1 : 0;
}
