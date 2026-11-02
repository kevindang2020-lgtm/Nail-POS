// suspended-access.guard.ts — Constitution 7 §19: a BILLING-ONLY session (the owner of a salon suspended for a cause that
// keeps billing access) may reach only what paying needs: its own sign-in/session routes and the salon's AI PowerSalon
// invoices / hardware payments. Everything else is refused server-side, whatever the owner's permissions say — hiding
// screens in the app is not the control. The moment the salon is ACTIVE again the gate lifts (the salon's current status
// is re-read for restricted sessions only), so a reactivated owner is not stuck until they sign out.
import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, Optional } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE } from '@aipowersalon/database';
import { suspensionPolicyFor } from '@aipowersalon/permissions';

export const BILLING_ONLY_PREFIXES = ['/auth/', '/tenant/account/invoices', '/owner/hardware-payment'] as const;
/**
 * §19 "Can data export continue?" — for a cause whose policy keeps data export (BILLING, TERMS, TENANT_REQUEST,
 * PLATFORM_OPERATION, OTHER), the salon's own report/data EXPORTS are also reachable: GET only, under /owner or /pos,
 * last segment export | export-xlsx | export-pdf. SECURITY / FRAUD never (their policy stops export).
 */
export function isSalonDataExport(method: string, path: string): boolean {
  if (String(method || 'GET').toUpperCase() !== 'GET') return false;
  const p = String(path || '').split('?')[0];
  if (!/^\/(owner|pos)\//.test(p)) return false;
  return /\/export(-xlsx|-pdf)?$/.test(p);
}
export const BILLING_ONLY_REFUSAL = { code: 'TENANT_SUSPENDED_BILLING_ONLY', message: 'Your salon is suspended. Only billing is available until it is reactivated.' };

export function billingOnlyAllows(path: string): boolean {
  const p = String(path || '').split('?')[0];
  return BILLING_ONLY_PREFIXES.some((pre) => p === pre.replace(/\/$/, '') || p.startsWith(pre.endsWith('/') ? pre : pre + '/') || p === pre);
}

@Injectable()
export class SuspendedAccessGuard implements CanActivate {
  constructor(@Optional() @Inject(DATABASE) private readonly db: any) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest();
    if (req?.ctx?.restriction !== 'SUSPENDED_BILLING_ONLY') return true;
    const path = String(req.route?.path ?? req.path ?? req.originalUrl ?? '');
    if (billingOnlyAllows(path)) return true;
    // lifted once the salon is active again; data exports allowed when the suspension cause keeps them (restricted
    // sessions only pay this read)
    if (this.db && req.ctx.tenantId) {
      const r: any = await sql`select status, suspension_reason_code from tenants where id = ${req.ctx.tenantId} limit 1`.execute(this.db).catch(() => ({ rows: [] }));
      if (r.rows[0]?.status === 'active') return true;
      if (isSalonDataExport(req.method, path) && suspensionPolicyFor(r.rows[0]?.suspension_reason_code).find((l) => l.capability === 'dataExport')?.allowed) return true;
    }
    throw new ForbiddenException(BILLING_ONLY_REFUSAL);
  }
}
