import { permissionsFor } from '@aipowersalon/permissions';
// owner-portfolio.controller.vitest.spec.ts — the multi-salon surface.
//
// The test that carries the whole feature: **a modified request must not move an owner into a salon they do not
// own.** The client says which salon it wants; the SERVER decides, and re-issues the session for the salon it
// approved. The tenant that ends up in the token is never the one the client sent.
import { describe, it, expect, beforeEach } from 'vitest';
import { OwnerPortfolioController } from './owner-portfolio.controller';
import { OwnerPortfolioGuard } from './owner-portfolio.guard';
import { InMemoryOwnerPortfolioRepo } from './owner-portfolio.repository';
import { verifySession, signSession } from '@aipowersalon/identity';
import type { OwnerPortfolio, SalonTotals } from './owner-portfolio-core';

const SECRET = 'test-session-secret-value-32-chars-long';
const OWNER = 'aaaaaaaa-1111-1111-1111-111111111111';
const T_LUXE = '11111111-1111-1111-1111-111111111111';
const T_RADIANT = '33333333-3333-3333-3333-333333333333';
const T_STRANGER = '99999999-9999-9999-9999-999999999999';

const portfolio: OwnerPortfolio = {
  ownerUserId: OWNER,
  salons: [
    { tenantId: T_LUXE, salonName: 'Luxe Nails & Spa', storeCode: 'LUXE01', tenantStatus: 'active',
      accessLevel: 'owner', isPrimaryOwner: true,
      branches: [{ branchId: 'b-downtown', name: 'Downtown', city: 'Marlton', state: 'NJ', isActive: true }] },
    { tenantId: T_RADIANT, salonName: 'Radiant Nail Bar', storeCode: 'RAD01', tenantStatus: 'active',
      accessLevel: 'report_only', isPrimaryOwner: false,
      branches: [{ branchId: 'b-west', name: 'West End', city: 'Camden', state: 'NJ', isActive: true }] },
  ],
};

const totals: SalonTotals[] = [
  { tenantId: T_LUXE, appointmentsToday: 12, customersWaiting: 3, techniciansWorking: 5, revenueTodayCents: 145_50, revenueMonthCents: 2_400_00, tipsTodayCents: 22_75 },
  { tenantId: T_RADIANT, appointmentsToday: 4, customersWaiting: 0, techniciansWorking: 2, revenueTodayCents: 60_00, revenueMonthCents: 800_00, tipsTodayCents: 9_50 },
];

/** A response object that records what the controller did. */
function fakeRes() {
  const out: any = { statusCode: 0, body: null, cookies: {} as Record<string, string> };
  out.cookie = (n: string, v: string) => { out.cookies[n] = v; return out; };
  out.status = (c: number) => { out.statusCode = c; return out; };
  out.json = (b: any) => { out.body = b; return out; };
  return out;
}

/** A request carrying a VERIFIED session (as the middleware would have produced). */
function ownerReq(tenantId: string | null = T_LUXE) {
  const token = signSession(
    { userId: OWNER, tenantId, branchId: null, role: 'OWNER', permissions: [], subscriptionStatus: 'active', sid: 'sess-1' },
    { secret: SECRET },
  );
  return {
    ctx: { userId: OWNER, tenantId, branchId: null, role: 'OWNER', permissions: [] },
    // A BROWSER sets Origin, and page script cannot forge it — so the API keeps the token in the httpOnly cookie
    // and never echoes it into the body. (Omitting Origin here would make this look like a native client, which
    // legitimately DOES receive a token — see auth/native-client.ts.)
    headers: { cookie: `aps_session=${token}`, origin: 'https://owner.aipowersalon.com' },
    ip: '1.2.3.4',
  };
}

let repo: InMemoryOwnerPortfolioRepo;
let ctrl: OwnerPortfolioController;
const prevSecret = process.env.AUTH_SESSION_SECRET;

beforeEach(() => {
  process.env.AUTH_SESSION_SECRET = SECRET;
  repo = new InMemoryOwnerPortfolioRepo(portfolio, totals);
  ctrl = new OwnerPortfolioController(repo);
});

describe('GET /owner/portfolio — one login, every salon', () => {
  it('lists every salon the owner may enter, with their role AT EACH', async () => {
    const r: any = await ctrl.portfolio(ownerReq());
    expect(r.salons).toHaveLength(2);
    expect(r.salons[0]).toMatchObject({ salonName: 'Luxe Nails & Spa', accessLevel: 'owner', isPrimaryOwner: true });
    expect(r.salons[1]).toMatchObject({ salonName: 'Radiant Nail Bar', accessLevel: 'report_only' });
  });

  it('a DIFFERENT owner sees none of these salons', async () => {
    const other = { ...ownerReq(), ctx: { userId: 'someone-else', tenantId: T_LUXE, role: 'OWNER' } };
    const r: any = await ctrl.portfolio(other);
    expect(r.salons).toHaveLength(0);
  });

  it('branches come with the salon, so the switcher can offer locations', async () => {
    const r: any = await ctrl.portfolio(ownerReq());
    expect(r.salons[0].branches[0]).toMatchObject({ name: 'Downtown', city: 'Marlton', isActive: true });
  });
});

describe('POST /owner/context/switch — SERVER-VERIFIED', () => {
  it('switching to a salon they own re-issues the session for THAT salon', async () => {
    const res = fakeRes();
    await ctrl.switchSalon(ownerReq(), { salonId: T_RADIANT }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.activeSalonId).toBe(T_RADIANT);

    // the SESSION now carries the new tenant — which is what all 93 tenant-scoped owner queries read
    const v: any = verifySession(res.cookies['aps_session'], { secret: SECRET });
    expect(v.valid).toBe(true);
    expect(v.payload.tenantId).toBe(T_RADIANT);
  });

  it('THE TEST THAT CARRIES THE FEATURE: a salon they do NOT own is refused', async () => {
    const res = fakeRes();
    await expect(ctrl.switchSalon(ownerReq(), { salonId: T_STRANGER }, res))
      .rejects.toMatchObject({ status: 403 });

    expect(res.cookies['aps_session']).toBeUndefined();   // no session was minted
    expect(repo.switches).toHaveLength(0);                // and nothing was recorded as a switch
  });

  it('the refusal does not reveal whether that salon exists', async () => {
    const notMine = await ctrl.switchSalon(ownerReq(), { salonId: T_STRANGER }, fakeRes()).catch((e) => e);
    const garbage = await ctrl.switchSalon(ownerReq(), { salonId: 'nope' }, fakeRes()).catch((e) => e);
    expect(notMine.getResponse().message).toBe(garbage.getResponse().message);
  });

  it('a branch from ANOTHER salon cannot smuggle a cross-tenant context through', async () => {
    // 'b-west' belongs to Radiant. Requesting it *under Luxe* must fail.
    await expect(ctrl.switchSalon(ownerReq(), { salonId: T_LUXE, branchId: 'b-west' }, fakeRes()))
      .rejects.toMatchObject({ status: 403 });
  });

  it('the re-issued session KEEPS its sid — an owner session stays revocable', async () => {
    const res = fakeRes();
    await ctrl.switchSalon(ownerReq(), { salonId: T_RADIANT }, res);
    const v: any = verifySession(res.cookies['aps_session'], { secret: SECRET });
    expect(v.payload.sid).toBe('sess-1');   // "sign out other devices" still works after a switch
  });

  it('the switch is AUDITED — it is how an owner moves between businesses', async () => {
    await ctrl.switchSalon(ownerReq(), { salonId: T_RADIANT }, fakeRes());
    expect(repo.switches).toEqual([{ tenantId: T_RADIANT, branchId: null }]);
  });

  it('a BROWSER gets the session in the cookie and NEVER in the body', async () => {
    const res = fakeRes();
    await ctrl.switchSalon(ownerReq(), { salonId: T_RADIANT }, res);
    expect(res.cookies['aps_session']).toBeTruthy();
    // the token stays out of JavaScript, so an XSS bug in the Owner App cannot steal it
    expect(JSON.stringify(res.body)).not.toContain(res.cookies['aps_session']);
  });

  it('the NATIVE Owner App gets a token — it cannot use the cookie at all', async () => {
    const res = fakeRes();
    const native = { ...ownerReq(), headers: { ...ownerReq().headers, origin: 'capacitor://localhost' } };
    await ctrl.switchSalon(native, { salonId: T_RADIANT }, res);
    expect(res.body.accessToken).toBe(res.cookies['aps_session']);
  });
});

describe('GET /owner/portfolio/summary — authorized salons only', () => {
  it('aggregates in INTEGER CENTS across the salons she may report on', async () => {
    const r: any = await ctrl.summary(ownerReq());
    expect(r.summary.totalSalons).toBe(2);
    expect(r.summary.revenueTodayCents).toBe(145_50 + 60_00);
    expect(Number.isInteger(r.summary.revenueTodayCents)).toBe(true);
  });

  it("a report-only salon contributes REVENUE but not operational counts", async () => {
    const r: any = await ctrl.summary(ownerReq());
    // Radiant is report_only → no 'view' → its 4 appointments and 2 technicians are excluded…
    expect(r.summary.appointmentsToday).toBe(12);
    expect(r.summary.techniciansWorking).toBe(5);
    // …but its revenue counts, because she IS allowed to see its reports.
    expect(r.summary.revenueTodayCents).toBe(145_50 + 60_00);
  });

  it('the database is only ever asked about salons she may report on', async () => {
    // A salon she cannot report on is never even queried — so it cannot leak through an aggregate.
    const restricted: OwnerPortfolio = {
      ownerUserId: OWNER,
      salons: [{ ...portfolio.salons[0], accessLevel: 'viewer' },
               { ...portfolio.salons[1], tenantStatus: 'suspended' }],
    };
    const r2 = new InMemoryOwnerPortfolioRepo(restricted, totals);
    const c2 = new OwnerPortfolioController(r2);
    const out: any = await c2.summary(ownerReq());
    // the suspended salon contributes nothing at all
    expect(out.summary.revenueTodayCents).toBe(145_50);
    expect(out.summary.activeSalons).toBe(1);
  });
});

describe('the guard keeps salon staff out of the portfolio', () => {
  const guard = new OwnerPortfolioGuard();
  // BUILD_PLAN Phase 9: a session carries its role's real permissions; the guard decides by owner.branches.compare
  const asRole = (role: string, permissions: string[] = role === 'CUSTOMER' ? [] : permissionsFor(role as any)) => ({
    switchToHttp: () => ({ getRequest: () => ({ ctx: { userId: 'u1', role, permissions } }) }),
  }) as any;

  it('Phase 9: an OWNER-role session whose owner.branches.compare was DENIED is refused; a manager granted it is let in', () => {
    expect(() => guard.canActivate(asRole('OWNER', permissionsFor('OWNER' as any).filter((k) => k !== 'owner.branches.compare')))).toThrow(/owner access only/i);
    expect(guard.canActivate(asRole('MANAGER', [...permissionsFor('MANAGER' as any), 'owner.branches.compare']))).toBe(true);
  });

  it('an OWNER is allowed', () => {
    expect(guard.canActivate(asRole('OWNER'))).toBe(true);
  });

  it('a MANAGER, RECEPTION or TECHNICIAN is REFUSED', () => {
    // The portfolio lists every salon this person may enter — showing it to salon staff would tell a
    // receptionist at one salon which other businesses the owner runs.
    for (const role of ['MANAGER', 'RECEPTION', 'FRONT_DESK', 'TECHNICIAN', 'CUSTOMER']) {
      expect(() => guard.canActivate(asRole(role)), role).toThrow(/owner access only/i);
    }
  });

  it('an unauthenticated request is refused', () => {
    const noCtx = { switchToHttp: () => ({ getRequest: () => ({}) }) } as any;
    expect(() => guard.canActivate(noCtx)).toThrow();
  });
});

if (prevSecret !== undefined) process.env.AUTH_SESSION_SECRET = prevSecret;
