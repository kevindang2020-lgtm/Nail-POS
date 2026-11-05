// update-required.middleware.ts — BUILD_PLAN Phase 13 B (Constitution 6 §55–57): 426 UPDATE_REQUIRED for a native build
// below its configured minimum. The decision is updateRequiredFor (@aipowersalon/api-contracts — the one copy, with the
// hard rules pinned in its test): only a request carrying X-Client-Type (a store app) + X-Client-Version + an ios / android
// X-Client-Platform can be refused; the web apps, the customer display, the kiosk and anything without the headers never
// are; no configured row → nothing refused; sign-in / refresh / health / /app-config / webhooks are exempt.
//
// Applied to every route right after the request context (app.module.ts), before the session middleware: an outdated
// build is told to update before it is asked to sign in again. Fails OPEN: a policy read error keeps the last good
// snapshot, and an exception here lets the request through (an outage must never start refusing apps).
//
// The same pass notes the install's version for the Super Admin distribution (§150) — hashed device id, at most once an
// hour per install, never awaited.
import { Injectable, NestMiddleware } from '@nestjs/common';
import { registry } from '@aipowersalon/observability';
import { updateRequiredFor, parseClientHeaders } from '@aipowersalon/api-contracts';
import { MobileVersionsService } from './mobile-versions.service';

export const updateRequiredRefusals = registry.counter('aipowersalon_update_required_total', 'Requests refused 426 UPDATE_REQUIRED (Constitution 6 §55)', ['app', 'platform']);

@Injectable()
export class UpdateRequiredMiddleware implements NestMiddleware {
  constructor(private readonly versions: MobileVersionsService) {}
  async use(req: any, res: any, next: () => void): Promise<void> {
    try {
      const c = parseClientHeaders(req?.headers);
      if (!c.app) return next();   // web apps without the transport, display, kiosk, providers, curl: nothing to do
      this.versions.noteSeen(c.app, c.platform, c.version, req?.headers?.['x-device-id']);
      await this.versions.policies();
      const path = String(req.originalUrl ?? req.url ?? '/').split('?')[0];
      const body = updateRequiredFor({ headers: req.headers, path, method: req.method }, (app, platform) => this.versions.lookup(app, platform));
      if (!body) return next();
      updateRequiredRefusals.inc({ app: body.app, platform: body.platform });
      res.status(426).setHeader?.('Cache-Control', 'no-store');
      res.status(426).json(body);
    } catch {
      next();
    }
  }
}
