// push-providers.ts — pluggable delivery backends, selected from env by selectPushProvider().
//
// Real transports (activate when their credentials are configured; inert otherwise):
//   • ApnsPushProvider — Apple Push Notification service over HTTP/2 with token-based auth (ES256 JWT from the
//     .p8 key). iOS device tokens from @capacitor/push-notifications are RAW APNs tokens, so iOS routes here.
//     Env: APNS_KEY_P8 (PEM; \n-escaped ok) or APNS_KEY_P8_B64, APNS_KEY_ID, APNS_TEAM_ID,
//          APNS_TOPIC (default bundle id) + optional per-app APNS_TOPIC_TECH/_CUSTOMER/_OWNER/_MANAGER/_POS,
//          APNS_ENV=sandbox|production (default production).
//   • FcmV1PushProvider — Firebase Cloud Messaging HTTP v1 with an OAuth2 service account (Android + web tokens).
//     Env: FCM_SERVICE_ACCOUNT_JSON (raw JSON) or FCM_SERVICE_ACCOUNT_B64 (base64 of the JSON).
//     NOTE: the legacy FCM server-key API (fcm.googleapis.com/fcm/send) was RETIRED by Google in June 2024 and can
//     no longer deliver anything; FCM_SERVER_KEY is therefore recognized only to warn — it never selects a provider.
//
// Honesty invariant (same class as payments): a send is only ever reported ok:true by a real provider response.
// With no credentials in production, sends return {ok:false, error:'push_not_configured'} and are logged as failed —
// the mock (which fabricates success) is reachable only outside production.
import { instrumentedFetch, recordProviderCall, classifyResponse } from '@aipowersalon/observability';
import { createSign, sign as cryptoSign } from 'node:crypto';
import { connect as http2Connect } from 'node:http2';
import type { PushProvider, PushMessage, PushTarget, PushSendResult } from './push.types';

const b64url = (input: Buffer | string): string =>
  (Buffer.isBuffer(input) ? input : Buffer.from(input)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// ---------------------------------------------------------------- mock (dev/test only — fabricates success)
export class MockPushProvider implements PushProvider {
  readonly name = 'mock';
  async send(target: PushTarget, _msg: PushMessage): Promise<PushSendResult> {
    return { ok: true, providerId: 'mock-' + target.token.slice(-6) };
  }
}

// ------------------------------------------------- honest "nothing configured" (production default, fails closed)
export class NotConfiguredPushProvider implements PushProvider {
  readonly name = 'not_configured';
  constructor(private readonly reason: string = 'push_not_configured') {}
  async send(_target: PushTarget, _msg: PushMessage): Promise<PushSendResult> {
    return { ok: false, error: this.reason };
  }
}

// ---------------------------------------------------------------------------- FCM HTTP v1 (Android + web tokens)
export interface FcmServiceAccount { project_id: string; client_email: string; private_key: string }

export class FcmV1PushProvider implements PushProvider {
  readonly name = 'fcm';
  private cached: { token: string; expMs: number } | null = null;
  constructor(private readonly sa: FcmServiceAccount, private readonly fetchImpl: typeof fetch = instrumentedFetch('fcm', fetch) as typeof fetch) {}

  private async accessToken(): Promise<string> {
    const now = Date.now();
    if (this.cached && this.cached.expMs - 60_000 > now) return this.cached.token;
    const iat = Math.floor(now / 1000);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64url(JSON.stringify({
      iss: this.sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600,
    }));
    const signer = createSign('RSA-SHA256'); signer.update(`${header}.${claims}`);
    const assertion = `${header}.${claims}.${b64url(signer.sign(this.sa.private_key))}`;
    const res = await this.fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(assertion)}`,
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) throw new Error('fcm_oauth_' + (j?.error || res.status));
    this.cached = { token: String(j.access_token), expMs: now + Math.min(Number(j.expires_in) || 3600, 3600) * 1000 };
    return this.cached.token;
  }

  async send(target: PushTarget, msg: PushMessage): Promise<PushSendResult> {
    try {
      const at = await this.accessToken();
      const res = await this.fetchImpl(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.sa.project_id)}/messages:send`, {
        method: 'POST', headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
        // merged from the developer tree (Oct 23 2026): Android shows the push as a heads-up banner with sound on the
        // high-priority channel the apps create (high_priority_v2, AndroidManifest default channel) — without it the
        // notification landed silently on the default channel
        body: JSON.stringify({ message: { token: target.token, notification: { title: msg.title, body: msg.body || '' }, data: msg.data || {},
          android: { priority: 'HIGH', notification: { channel_id: 'high_priority_v2', sound: 'default', default_sound: true, default_vibrate_timings: true } } } }),
      });
      const j: any = await res.json().catch(() => ({}));
      if (res.ok && j.name) return { ok: true, providerId: String(j.name) };
      const status = j?.error?.status || '';
      const detailCode = Array.isArray(j?.error?.details) ? j.error.details.map((d: any) => d?.errorCode).find(Boolean) : undefined;
      if (status === 'NOT_FOUND' || detailCode === 'UNREGISTERED') return { ok: false, error: 'unregistered' };
      return { ok: false, error: 'fcm_' + (detailCode || status || res.status) };
    } catch (e: any) { return { ok: false, error: e?.message || 'fcm_error' }; }
  }
}

// -------------------------------------------------------------------- APNs HTTP/2, token-based auth (iOS tokens)
export interface ApnsConfig { keyPem: string; keyId: string; teamId: string; topics: Record<string, string>; defaultTopic?: string; host?: string }
const APNS_UNREGISTERED = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic', 'ExpiredToken']);

export class ApnsPushProvider implements PushProvider {
  readonly name = 'apns';
  private cached: { jwt: string; mintedMs: number } | null = null;
  constructor(private readonly cfg: ApnsConfig) {}

  topicFor(app: string | null | undefined): string | undefined {
    return (app && this.cfg.topics[app]) || this.cfg.defaultTopic;
  }

  // Apple: refresh the provider token every 20–60 minutes. Cached for 45.
  jwt(nowMs: number = Date.now()): string {
    if (this.cached && nowMs - this.cached.mintedMs < 45 * 60_000) return this.cached.jwt;
    const header = b64url(JSON.stringify({ alg: 'ES256', kid: this.cfg.keyId }));
    const claims = b64url(JSON.stringify({ iss: this.cfg.teamId, iat: Math.floor(nowMs / 1000) }));
    // JWT ES256 requires the raw R||S (ieee-p1363) signature encoding, not ASN.1/DER.
    const sig = cryptoSign('sha256', Buffer.from(`${header}.${claims}`), { key: this.cfg.keyPem, dsaEncoding: 'ieee-p1363' });
    const jwt = `${header}.${claims}.${b64url(sig)}`;
    this.cached = { jwt, mintedMs: nowMs };
    return jwt;
  }

  /** Merged from the developer tree (Oct 23 2026): a token from a development build (Xcode / TestFlight-debug) belongs to
   *  APNs' SANDBOX; the production host answers BadDeviceToken for it (and the reverse). One retry on the other host with
   *  the same JWT — the default stays PRODUCTION (the developer's tree defaulted to the sandbox, which would have failed
   *  every App Store install). */
  async send(target: PushTarget, msg: PushMessage): Promise<PushSendResult> {
    const topic = this.topicFor(target.app);
    if (!topic) return { ok: false, error: 'apns_topic_not_configured' }; // per-app bundle id missing — honest refusal, no network
    const primary = this.cfg.host || 'https://api.push.apple.com';
    const first = await this.sendToHost(primary, target, msg, topic);
    if (first.error !== 'apns_BadDeviceToken') return first;
    const other = primary.includes('sandbox') ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com';
    const second = await this.sendToHost(other, target, msg, topic);
    if (second.ok) return second;
    // bad on BOTH hosts: the token really is dead → 'unregistered' (the dispatcher revokes it), as before
    return second.error === 'apns_BadDeviceToken' ? { ok: false, error: 'unregistered' } : second;
  }
  private async sendToHost(host: string, target: PushTarget, msg: PushMessage, topic: string): Promise<PushSendResult> {
    let session: ReturnType<typeof http2Connect> | null = null;
    try {
      const jwt = this.jwt();
      session = http2Connect(host);
      const body = JSON.stringify({ aps: { alert: { title: msg.title, body: msg.body || '' }, sound: 'default' }, ...(msg.data || {}) });
      const result = await new Promise<PushSendResult>((resolve) => {
        const apnsStartedAt = Date.now();
        const req = session!.request({
          ':method': 'POST', ':path': `/3/device/${target.token}`,
          authorization: `bearer ${jwt}`, 'apns-topic': topic, 'apns-push-type': 'alert', 'apns-priority': '10',
          'content-type': 'application/json', 'content-length': Buffer.byteLength(body),
        });
        let status = 0; let apnsId = ''; const chunks: Buffer[] = [];
        req.on('response', (h) => { status = Number(h[':status'] || 0); apnsId = String(h['apns-id'] || ''); });
        req.on('data', (c) => chunks.push(c));
        req.on('error', (e) => { recordProviderCall('apns', '/3/device/:token', 'network', Date.now() - apnsStartedAt); resolve({ ok: false, error: 'apns_' + (e?.message || 'stream_error') }); });
        req.on('end', () => {
          recordProviderCall('apns', '/3/device/:token', classifyResponse(status), Date.now() - apnsStartedAt);   // §194: every APNs call, by status class
          if (status === 200) return resolve({ ok: true, providerId: apnsId || 'apns' });
          let reason = '';
          try { reason = JSON.parse(Buffer.concat(chunks).toString('utf8'))?.reason || ''; } catch { /* no body */ }
          if (reason === 'BadDeviceToken') return resolve({ ok: false, error: 'apns_BadDeviceToken' });   // decided by send(): the other host first
          if (status === 410 || APNS_UNREGISTERED.has(reason)) return resolve({ ok: false, error: 'unregistered' });
          resolve({ ok: false, error: 'apns_' + (reason || status) });
        });
        req.setTimeout(10_000, () => { try { req.close(); } catch { /* noop */ } recordProviderCall('apns', '/3/device/:token', 'timeout', Date.now() - apnsStartedAt); resolve({ ok: false, error: 'apns_timeout' }); });
        req.end(body);
      });
      return result;
    } catch (e: any) {
      return { ok: false, error: 'apns_' + (e?.message || 'error') };
    } finally {
      try { session?.close(); } catch { /* noop */ }
    }
  }
}

// ------------------------------------------------------------------- platform router (ios→APNs, android/web→FCM)
export class CompositePushProvider implements PushProvider {
  readonly name: string;
  constructor(private readonly legs: { ios?: PushProvider; android?: PushProvider; web?: PushProvider }) {
    this.name = [legs.ios && 'apns', (legs.android || legs.web) && 'fcm'].filter(Boolean).join('+') || 'not_configured';
  }
  async send(target: PushTarget, msg: PushMessage): Promise<PushSendResult> {
    const leg = this.legs[target.platform];
    if (!leg) return { ok: false, error: `push_not_configured_for_${target.platform}` };
    return leg.send(target, msg);
  }
}

// --------------------------------------------------------------------------------------------- env-based selection
export function apnsConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ApnsConfig | null {
  let keyPem = env.APNS_KEY_P8 || '';
  if (!keyPem && env.APNS_KEY_P8_B64) { try { keyPem = Buffer.from(env.APNS_KEY_P8_B64, 'base64').toString('utf8'); } catch { keyPem = ''; } }
  keyPem = keyPem.replace(/\\n/g, '\n').trim();
  const keyId = (env.APNS_KEY_ID || '').trim(); const teamId = (env.APNS_TEAM_ID || '').trim();
  if (!keyPem || !keyId || !teamId) return null;
  const topics: Record<string, string> = {};
  for (const [app, v] of [['tech', env.APNS_TOPIC_TECH], ['customer', env.APNS_TOPIC_CUSTOMER], ['owner', env.APNS_TOPIC_OWNER], ['manager', env.APNS_TOPIC_MANAGER], ['pos', env.APNS_TOPIC_POS]] as const) {
    if (v && v.trim()) topics[app] = v.trim();
  }
  return {
    keyPem, keyId, teamId, topics, defaultTopic: (env.APNS_TOPIC || '').trim() || undefined,
    host: (env.APNS_ENV || '').trim().toLowerCase() === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com',
  };
}

export function fcmServiceAccountFromEnv(env: NodeJS.ProcessEnv = process.env): FcmServiceAccount | null {
  let raw = env.FCM_SERVICE_ACCOUNT_JSON || '';
  if (!raw && env.FCM_SERVICE_ACCOUNT_B64) { try { raw = Buffer.from(env.FCM_SERVICE_ACCOUNT_B64, 'base64').toString('utf8'); } catch { raw = ''; } }
  if (!raw.trim()) return null;
  try {
    const j = JSON.parse(raw);
    if (j?.project_id && j?.client_email && j?.private_key) {
      return { project_id: String(j.project_id), client_email: String(j.client_email), private_key: String(j.private_key).replace(/\\n/g, '\n') };
    }
  } catch { /* fall through */ }
  console.warn('[push] FCM_SERVICE_ACCOUNT_JSON/_B64 is set but is not a valid service-account JSON (needs project_id, client_email, private_key) — FCM leg not configured.');
  return null;
}

export function selectPushProvider(env: NodeJS.ProcessEnv = process.env): PushProvider {
  const apnsCfg = apnsConfigFromEnv(env);
  const fcmSa = fcmServiceAccountFromEnv(env);
  if (apnsCfg || fcmSa) {
    const apns = apnsCfg ? new ApnsPushProvider(apnsCfg) : undefined;
    const fcm = fcmSa ? new FcmV1PushProvider(fcmSa) : undefined;
    return new CompositePushProvider({ ios: apns, android: fcm, web: fcm });
  }
  if (env.FCM_SERVER_KEY) {
    console.warn('[push] FCM_SERVER_KEY is set, but Google retired the legacy FCM server-key API in June 2024 — it cannot deliver. Configure FCM_SERVICE_ACCOUNT_JSON (HTTP v1) and, for iOS, the APNS_* variables.');
    return new NotConfiguredPushProvider('push_legacy_fcm_retired');
  }
  // No credentials at all: fabricated success is acceptable only outside production.
  return env.NODE_ENV === 'production' ? new NotConfiguredPushProvider() : new MockPushProvider();
}
