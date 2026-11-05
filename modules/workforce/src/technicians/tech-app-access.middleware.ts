// tech-app-access.middleware.ts — enforces the Technician App on/off switch.
//
// THE GAP. The App Access screen lets a manager switch a technician's app OFF. `technician_app_settings.app_enabled`
// was read only to DISPLAY that toggle; nothing consulted it when the technician used the app. So a technician whose
// access was switched off — someone who has just left, say — could keep signing in and seeing their customers and
// earnings, for as long as their account stayed active.
//
// WHY A MIDDLEWARE ON THE `tech/*` PREFIX, not a login check or a per-controller guard:
//  • Login cannot tell the apps apart. Technicians sign into the POS with the same account (TECHNICIAN holds
//    pos.login), and "app access off" must not lock them out of the POS they clock in on. The tech app is identified
//    by the API surface it calls — `/tech/*` — and the POS by `/pos/*`.
//  • Checking every request also covers sessions that are ALREADY OPEN, which a login check never would.
//  • There are ten controllers under `tech/*` across nine modules and none shares a guard. A per-controller guard is
//    exactly the thing the next tech controller forgets. A prefix middleware covers routes that do not exist yet.
//
// WHO IT APPLIES TO: only role TECHNICIAN. Owners and managers view tech screens on purpose and are never blocked.
//
// COST: one indexed lookup per technician per 30 s, cached. A manager's change takes effect immediately on the
// instance that handled it (invalidateTechAppAccess) and within 30 s everywhere else.
//
// FAILURE DIRECTION: a lookup ERROR lets the request through. This is the same decision Constitution 9 made for the
// authorization poll, for the same reason: a database blip must not lock an entire salon's technicians out of their
// app. The case being defended against — a disabled technician — coinciding with a lookup failure is narrow; locking
// out every working technician on every blip is not.
import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { DATABASE } from '@aipowersalon/database';

const TTL_MS = 30_000;
const cache = new Map<string, { enabled: boolean; at: number }>();
const key = (tenantId: string, userId: string) => `${tenantId}:${userId}`;

/** Drop cached decisions so a manager's change applies at once on this instance. No user → the whole tenant. */
export function invalidateTechAppAccess(tenantId: string, userId?: string): void {
  if (userId) { cache.delete(key(tenantId, userId)); return; }
  for (const k of [...cache.keys()]) if (k.startsWith(`${tenantId}:`)) cache.delete(k);
}

/** Test seam: clear everything. */
export function resetTechAppAccessCache(): void { cache.clear(); }

export const TECH_APP_DISABLED = {
  code: 'tech_app_disabled',
  message: 'Your access to the Technician App has been turned off. Please speak to your salon manager.',
};

@Injectable()
export class TechnicianAppAccessMiddleware implements NestMiddleware {
  /** Clock seam for tests. Not a constructor parameter: Nest DI would try to resolve it. */
  now: () => number = Date.now;

  constructor(@Inject(DATABASE) private readonly db: any) {}

  /**
   * Whether this technician's app is enabled. NO ROW means enabled — matching getAppAccess(), which displays a
   * technician with no settings row as enabled. The screen and the enforcement must agree, or a manager sees "on"
   * for a technician who is blocked.
   */
  async isEnabled(tenantId: string, userId: string): Promise<boolean> {
    const k = key(tenantId, userId);
    const hit = cache.get(k);
    if (hit && this.now() - hit.at < TTL_MS) return hit.enabled;
    const row = await this.db.selectFrom('technician_app_settings as s')
      .innerJoin('technicians as t', 't.id', 's.technician_id')
      .where('t.tenant_id', '=', tenantId).where('t.user_id', '=', userId)
      .select('s.app_enabled').executeTakeFirst();
    const enabled = row ? !!row.app_enabled : true;
    cache.set(k, { enabled, at: this.now() });
    return enabled;
  }

  async use(req: any, res: any, next: () => void): Promise<void> {
    const ctx = req.ctx;
    if (!ctx || ctx.role !== 'TECHNICIAN' || !ctx.tenantId || !ctx.userId || !this.db) return next();
    let enabled = true;
    try { enabled = await this.isEnabled(ctx.tenantId, ctx.userId); }
    catch { return next(); }   // fail open on a lookup error — see header
    if (enabled) return next();
    res.status(403).json(TECH_APP_DISABLED);
  }
}
