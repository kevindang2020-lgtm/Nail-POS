// twilio-verify-service.ts — talking to a salon's own Twilio Verify Service (BUILD_PLAN Phase 4).
//
// Shared by the booking module (send / check a code) and the communications module (the salon's "Test Verify" button),
// so both resolve the endpoint the same way and sign the same way.

/**
 * Where Twilio Verify lives. The ONLY override is a LOCAL fake Verify service for the live proofs
 * (TWILIO_VERIFY_BASE_URL=http://127.0.0.1:<port>) and it is honoured only outside production and only for a loopback
 * address: a stray env var in production must never send a salon's Twilio credentials anywhere but Twilio. The fake
 * still decides the code exactly as Twilio would — nothing in the API accepts a code on its own (no master code).
 */
export function twilioVerifyBase(env: Record<string, string | undefined> = process.env): string {
  const o = String(env.TWILIO_VERIFY_BASE_URL ?? '').trim();
  if (o && env.NODE_ENV !== 'production' && /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(o)) return o;
  return 'https://verify.twilio.com';
}

/** What signs a Verify call: an API key (SK…) and its secret when the salon gave one, else the account auth token. */
export interface VerifyAuth { accountSid: string; authToken?: string | null; apiKeySid?: string | null; apiKeySecret?: string | null }

export function verifyAuthHeader(a: VerifyAuth): string {
  const user = a.apiKeySid && a.apiKeySecret ? a.apiKeySid : a.accountSid;
  const pass = a.apiKeySid && a.apiKeySecret ? a.apiKeySecret : String(a.authToken ?? '');
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

export const isVerifyServiceSid = (s: unknown): s is string => typeof s === 'string' && /^VA[0-9a-fA-F]{32}$/.test(s);
export const isApiKeySid = (s: unknown): s is string => typeof s === 'string' && /^SK[0-9a-fA-F]{32}$/.test(s);

export type VerifyServiceProbe = { ok: true; friendlyName: string | null } | { ok: false; error: string };

/**
 * "Test Verify": fetch the salon's Verify Service with the salon's own credentials. Sends nothing, costs nothing, and
 * proves exactly what a code send needs — the SID exists on THIS account and the credentials may use it.
 */
export async function probeVerifyService(auth: VerifyAuth, serviceSid: string, http: typeof fetch = fetch): Promise<VerifyServiceProbe> {
  if (!isVerifyServiceSid(serviceSid)) return { ok: false, error: 'That is not a Verify Service SID (it starts with VA).' };
  try {
    const res = await http(`${twilioVerifyBase()}/v2/Services/${serviceSid}`, { method: 'GET', headers: { Authorization: verifyAuthHeader(auth) } });
    const body: any = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, friendlyName: body?.friendly_name ? String(body.friendly_name).slice(0, 80) : null };
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'Twilio refused these credentials for this Verify Service.' };
    if (res.status === 404) return { ok: false, error: 'No Verify Service with that SID on this Twilio account.' };
    return { ok: false, error: `Twilio returned ${res.status}${body?.message ? `: ${String(body.message).slice(0, 120)}` : ''}` };
  } catch (e: any) {
    return { ok: false, error: `Could not reach Twilio Verify: ${String(e?.message ?? e).slice(0, 120)}` };
  }
}
