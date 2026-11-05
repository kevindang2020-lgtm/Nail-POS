// client-errors.controller.ts — Constitution 11 §125–130, §197–200: crash and error reports from the web apps.
//
// Seven React apps had no error boundary and nowhere to send a report: an unexpected render error was a blank screen
// and nothing reached operations. The boundary in @aipowersalon/ui posts here.
//
// PUBLIC BY NECESSITY. A crash on the login screen must be reportable, so this route cannot require a session. It
// returns nothing but 204, stores nothing, reads no tenant data, and takes a tenant ONLY from a session the request
// already carries (never from the body). It is listed with its reason in check:public's PUBLIC_BY_DESIGN.
//
// ABUSE. Anyone can post, so nothing here trusts the body: every field is length-capped and allow-listed; free text
// (message, stack) goes through the same redaction as server logs — secrets masked by value, emails and phones
// masked — before it is logged (§130: browser privacy); `app` and `kind` are allow-listed because they are metric
// labels (§38); a per-IP and a per-instance rate limit drop floods. Rejected or dropped reports still get 204 — a
// crashing client must never get an error back from its own error reporter, and an attacker learns nothing.
import { registry, log, maskValueSecrets, maskEmail, maskPhone } from '@aipowersalon/observability';
import { clientIp } from '@aipowersalon/security';
import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { CLIENT_ERROR_BODY } from './request-schemas';
import { ValidatedBody } from '@aipowersalon/permissions/guards';

export const CLIENT_APPS = ['pos', 'admin', 'owner', 'tech', 'customer', 'manager-pay', 'customer-display', 'kiosk'] as const;
export const CLIENT_ERROR_KINDS = ['render', 'unhandled', 'promise', 'api'] as const;
export const LIMITS = { message: 500, stack: 4000, route: 120, version: 32, perIpPerMinute: 30, perInstancePerMinute: 600 } as const;

export const clientErrors = registry.counter('aipowersalon_client_errors_total', 'Errors reported by web apps (§128)', ['app', 'kind', 'platform']);
/** Constitution 6 §118 (Phase 13): the shell the error happened in — a metric label, so allow-listed. */
export const CLIENT_ERROR_PLATFORMS = ['ios', 'android', 'web'] as const;
export const clientErrorsDropped = registry.counter('aipowersalon_client_errors_dropped_total', 'Reports refused (invalid or rate-limited)', ['reason']);

/** Free text from a browser → safe to log. Secrets by value, then emails and phone numbers. */
export function scrubClientText(s: unknown, max: number): string {
  if (typeof s !== 'string') return '';
  return maskValueSecrets(s.slice(0, max))
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, (m) => maskEmail(m))
    .replace(/\+?\d[\d\s().-]{8,}\d/g, (m) => maskPhone(m));
}

/** The client route with ids removed, so it groups (and cannot carry a customer id into a log search facet). */
export function normaliseClientRoute(r: unknown): string {
  if (typeof r !== 'string') return 'unknown';
  return r.split('?')[0].split('#')[0]
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:id')
    .replace(/\/\d+(?=\/|$)/g, '/:n')
    .slice(0, LIMITS.route) || '/';
}

export interface ClientErrorReport {
  app: (typeof CLIENT_APPS)[number]; kind: (typeof CLIENT_ERROR_KINDS)[number];
  message: string; stack: string; route: string; version: string; requestId: string | null;
  platform: (typeof CLIENT_ERROR_PLATFORMS)[number] | 'unknown';
}

/** Validates and scrubs. Returns null when the report is not worth keeping — never throws. */
export function parseReport(body: any): ClientErrorReport | null {
  if (!body || typeof body !== 'object') return null;
  if (!CLIENT_APPS.includes(body.app)) return null;
  if (!CLIENT_ERROR_KINDS.includes(body.kind)) return null;
  const requestId = typeof body.requestId === 'string' && /^req_[0-9A-Za-z]{10,40}$/.test(body.requestId) ? body.requestId : null;
  return {
    app: body.app, kind: body.kind,
    message: scrubClientText(body.message, LIMITS.message) || '(no message)',
    stack: scrubClientText(body.stack, LIMITS.stack),
    route: normaliseClientRoute(body.route),
    version: typeof body.version === 'string' ? body.version.replace(/[^\w.+-]/g, '').slice(0, LIMITS.version) : 'unknown',
    requestId,
    platform: (CLIENT_ERROR_PLATFORMS as readonly string[]).includes(body.platform) ? body.platform : 'unknown',
  };
}

/** A fixed-window limiter. In-memory and per instance: good enough to stop a flood without new infrastructure. */
export class WindowLimiter {
  private window = 0; private readonly byKey = new Map<string, number>(); private total = 0;
  constructor(private readonly perKey: number, private readonly perInstance: number, private readonly now: () => number = Date.now) {}
  allow(key: string): boolean {
    const w = Math.floor(this.now() / 60_000);
    if (w !== this.window) { this.window = w; this.byKey.clear(); this.total = 0; }
    const n = this.byKey.get(key) ?? 0;
    if (n >= this.perKey || this.total >= this.perInstance) return false;
    this.byKey.set(key, n + 1); this.total++;
    if (this.byKey.size > 10_000) this.byKey.clear();   // bounded memory under a distributed flood (§289)
    return true;
  }
}

@Controller('client-telemetry')
export class ClientErrorsController {
  readonly limiter = new WindowLimiter(LIMITS.perIpPerMinute, LIMITS.perInstancePerMinute);

  @Post('errors')
  @HttpCode(204)
  report(@Req() req: any, @Body(ValidatedBody(CLIENT_ERROR_BODY)) body: unknown): void {
    try {
      const ip = (clientIp(req) ?? 'unknown');
      if (!this.limiter.allow(ip)) { clientErrorsDropped.inc({ reason: 'rate_limited' }); return; }
      const r = parseReport(body);
      if (!r) { clientErrorsDropped.inc({ reason: 'invalid' }); return; }
      clientErrors.inc({ app: r.app, kind: r.kind, platform: r.platform });
      // §129: the requestId links this crash to the server's own log lines for the request that preceded it.
      const fields = { clientApp: r.app, clientKind: r.kind, clientRoute: r.route, clientVersion: r.version, clientPlatform: r.platform, failedRequestId: r.requestId, clientMessage: r.message, clientStack: r.stack };
      if (r.kind === 'api') log.warn('client.error', fields); else log.error('client.error', fields);
    } catch { /* an error reporter never errors */ }
  }
}
