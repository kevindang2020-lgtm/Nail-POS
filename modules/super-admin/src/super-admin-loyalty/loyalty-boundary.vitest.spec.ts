import { describe, it, expect } from 'vitest';
import { PATH_METADATA, METHOD_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { SuperAdminLoyaltyController } from './super-admin-loyalty.controller';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { LoyaltyActionsService } from './loyalty-actions.service';

function routesOf(ctrl: any) {
  const proto = ctrl.prototype;
  const method = (m: number) => RequestMethod[m] ?? String(m);
  return Object.getOwnPropertyNames(proto)
    .filter((nm) => nm !== 'constructor' && typeof proto[nm] === 'function' && Reflect.getMetadata(PATH_METADATA, proto[nm]) !== undefined)
    .map((nm) => ({ name: nm, path: String(Reflect.getMetadata(PATH_METADATA, proto[nm])), method: method(Reflect.getMetadata(METHOD_METADATA, proto[nm])) }));
}

// No route may mutate tenant loyalty STATE — no earn/redeem/adjust/grant/expire/set-balance/tier endpoints. Platform
// CAPABILITY config (limits/expiration/types/plan) + templates are allowed writes and configure capabilities only.
const FORBIDDEN = [/earn/i, /redeem/i, /adjust/i, /grant/i, /expire/i, /balance/i, /\btier\b/i, /award/i, /reverse/i, /delete/i];

describe('Loyalty Programs — backend boundary', () => {
  const routes = routesOf(SuperAdminLoyaltyController);
  it('is SuperAdminGuard-gated', () => {
    expect((Reflect.getMetadata(GUARDS_METADATA, SuperAdminLoyaltyController) ?? [])).toContain(SuperAdminGuard);
  });
  it('exposes read/export + platform-capability config + suspicious review only — no tenant points-mutation endpoints', () => {
    expect(new Set(routes.map((r) => r.path))).toEqual(new Set(['overview', 'dashboard', 'config', 'templates', 'suspicious/detect', 'suspicious', 'suspicious/:id/transition', 'corrections/detect', 'corrections', 'corrections/:id/review', 'export', 'export-xlsx']));
    for (const r of routes) for (const pat of FORBIDDEN) expect(`${r.name} ${r.path}`).not.toMatch(pat);
  });
  it('reads/exports are GET; config is PUT; templates create is POST', () => {
    const byName: Record<string, string[]> = {};
    for (const r of routes) (byName[r.path] ??= []).push(r.method);
    for (const p of ['overview', 'dashboard', 'export', 'export-xlsx']) expect(byName[p]).toContain('GET');
    expect(byName['config']).toEqual(expect.arrayContaining(['GET', 'PUT']));       // read + save
    expect(byName['templates']).toEqual(expect.arrayContaining(['GET', 'POST']));   // list + create
  });
});

const fakeDash = {
  getDashboard: async () => ({
    kpis: { loyaltyMembers: 120, pointsIssued: 444780, pointsRedeemed: 159540, liabilityCents: 232620, activePrograms: 2, engagementPct: 47.2, avgRedemptionRatePct: 22.6 },
    tenantPerformance: [{ tenantId: 'A', tenantName: 'Glamour Studio', activePrograms: 2, members: 60, engagementPct: 48, redemptionRatePct: 56, liabilityCents: 116000, status: 'Healthy' }, { tenantId: 'B', tenantName: '=cmd()', activePrograms: 1, members: 60, engagementPct: 44, redemptionRatePct: 54, liabilityCents: 98000, status: 'Watch' }],
  }),
} as any;
const actions = () => new LoyaltyActionsService(null, fakeDash);

describe('Loyalty export', () => {
  it('CSV includes the platform summary + per-tenant rows and guards formulas', async () => {
    const out = await actions().exportCsv({ userId: 'u' }, {});
    expect(out.contentType).toContain('text/csv');
    expect(out.body).toContain('Glamour Studio');
    expect(out.body).toContain('Outstanding Liability (USD),2326.20');
    expect(out.body).toContain("'=cmd()");   // formula-injection neutralized
  });
  it('XLSX is a real workbook (PK magic)', async () => {
    const out = await actions().exportXlsx({ userId: 'u' }, {});
    expect(out.buffer[0]).toBe(0x50); expect(out.buffer[1]).toBe(0x4b);
    expect(out.contentType).toContain('spreadsheetml.sheet');
  });
});
