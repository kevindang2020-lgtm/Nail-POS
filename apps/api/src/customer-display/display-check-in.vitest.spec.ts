// display-check-in.vitest.spec.ts — 23-inch dual-screen spec §8, §12, §18 (Unit 7): the display checks its guests in
// with ITS OWN credential. The state says whether check-in is on for the display's branch — no Go Check-In kiosk needs
// to exist anywhere; a guest's session is started from the device credential (the display, salon and branch are the
// credential's, never the request's); a display being serviced has no check-in; the public door is rate-limited per
// display and answers a refusal honestly.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { DEFAULT_CHECKOUT_SETTINGS } from '@aipowersalon/checkout';
import { GoCheckInError } from '@aipowersalon/queue';
import { CustomerDisplayService, DisplayError, type GoCheckInSlugPort } from './customer-display.service';
import { CustomerDisplayController, CHECK_IN_SESSIONS_PER_DISPLAY_PER_MINUTE } from './customer-display.controller';
import type { DisplayDataPort } from './customer-display.repository';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
type Dev = { id: string; tenantId: string; branchId: string | null; maintenance?: boolean };
const DEVICES: Record<string, Dev> = {
  [sha('front-token')]: { id: 'dev-front', tenantId: 't1', branchId: 'b2' },
  [sha('side-token')]: { id: 'dev-side', tenantId: 't1', branchId: 'b2' },
  [sha('serviced-token')]: { id: 'dev-serviced', tenantId: 't1', branchId: 'b2', maintenance: true },
};
const SESSION = { sessionId: 'gcs-1', sessionToken: 'guest-token', config: { salonName: 'Luxury Nails', branchName: 'Voorhees', settings: { enabled: true } } } as any;

function harness(opts: { on?: boolean; start?: GoCheckInSlugPort['startDisplaySession']; languages?: GoCheckInSlugPort['displayLanguages'] } = {}) {
  const asked: string[] = [];
  const started: Dev[] = [];
  const repo: Partial<DisplayDataPort> = {
    async deviceByToken(hash: string) { return DEVICES[hash] ?? null; },   // a revoked display's credential is simply not found
    async currentSessionForDevice() { return null; },
    async resolveSettings() { return { ...DEFAULT_CHECKOUT_SETTINGS }; },
    async salonName() { return 'Luxury Nails'; },
  };
  const port: GoCheckInSlugPort = {
    slugForBranch: async () => null,   // no Go Check-In kiosk anywhere in this salon
    checkInAvailable: async (t, b) => { asked.push(`${t}/${b}`); return opts.on ?? true; },
    startDisplaySession: opts.start ?? (async (d) => { started.push(d); return SESSION; }),
    ...(opts.languages ? { displayLanguages: opts.languages } : {}),
  };
  const svc = new CustomerDisplayService(repo as DisplayDataPort, undefined, undefined, port);
  return { svc, asked, started, ctl: new CustomerDisplayController(svc, undefined as any, undefined as any) };
}
const dev = (token?: string) => ({ ip: '203.0.113.7', headers: token ? { 'x-device-token': token } : {} });
const status = async (p: () => unknown) => {
  try { await p(); return 200; } catch (e) { return e instanceof HttpException ? e.getStatus() : -1; }
};

describe('the display\'s state says whether it checks guests in (§14, §18)', () => {
  it('on for the DISPLAY\'s branch — with no kiosk anywhere (there is no slug, and none is needed)', async () => {
    const h = harness();
    const s = await h.svc.getDeviceState('front-token');
    expect(s.state).toBe('idle');
    expect(s.checkIn).toBe(true);
    expect(s.goCheckInSlug).toBeUndefined();
    expect(h.asked).toEqual(['t1/b2']);                       // the credential's salon and branch
  });
  it('off for the branch: no check-in; a display being serviced has none (and does not even ask)', async () => {
    expect((await harness({ on: false }).svc.getDeviceState('front-token')).checkIn).toBeUndefined();
    const h = harness();
    const s = await h.svc.getDeviceState('serviced-token');
    expect(s).toMatchObject({ state: 'idle', maintenance: true });
    expect(s.checkIn).toBeUndefined();
    expect(h.asked).toEqual([]);
  });
});

describe('a guest\'s session is started with the display\'s own credential (§8, §12)', () => {
  it('the display, salon and branch are the CREDENTIAL\'s — the session token comes back once', async () => {
    const h = harness();
    expect(await h.svc.startCheckInSession('front-token')).toBe(SESSION);
    expect(h.started).toEqual([{ id: 'dev-front', tenantId: 't1', branchId: 'b2' }]);
  });
  it('no credential, a forged or a revoked one, and a display being serviced: refused — nothing is started', async () => {
    const h = harness();
    for (const t of [undefined, '', 'forged-token', 'serviced-token']) {
      await expect(h.svc.startCheckInSession(t)).rejects.toBeInstanceOf(DisplayError);
      await expect(h.svc.startCheckInSession(t)).rejects.toMatchObject({ code: 'forbidden' });
    }
    expect(h.started).toEqual([]);
  });
});

describe('the public door (§8, §18) — what anyone on the internet can reach', () => {
  afterEach(() => vi.useRealTimers());

  it('a display may start a few dozen sessions a minute (one per guest); the next is 429 — another display is unaffected, and a minute later it may again', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T15:00:05Z'));
    const h = harness();
    for (let i = 0; i < CHECK_IN_SESSIONS_PER_DISPLAY_PER_MINUTE; i++) expect(await status(() => h.ctl.deviceCheckInSession(dev('front-token')))).toBe(200);
    expect(await status(() => h.ctl.deviceCheckInSession(dev('front-token')))).toBe(429);
    expect(h.started).toHaveLength(CHECK_IN_SESSIONS_PER_DISPLAY_PER_MINUTE);              // the refused ask started nothing
    expect(await status(() => h.ctl.deviceCheckInSession(dev('side-token')))).toBe(200);
    vi.setSystemTime(new Date('2026-10-06T15:01:06Z'));
    expect(await status(() => h.ctl.deviceCheckInSession(dev('front-token')))).toBe(200);
  });

  it('the legacy ?deviceToken= form works too — the header wins when both are sent', async () => {
    const h = harness();
    expect(await status(() => h.ctl.deviceCheckInSession({ headers: {} }, 'front-token'))).toBe(200);
    expect(await status(() => h.ctl.deviceCheckInSession(dev('side-token'), 'front-token'))).toBe(200);
    expect(h.started.map((d) => d.id)).toEqual(['dev-front', 'dev-side']);
  });

  it('refusals are honest HTTP answers: switched off 403 (code "disabled"), no branch 409, a forged credential 403', async () => {
    const off = harness({ start: async () => { throw new GoCheckInError('Check-in is currently turned off for this salon.', 403, 'disabled'); } });
    const e = await (off.ctl.deviceCheckInSession(dev('front-token')) as Promise<unknown>).catch((x) => x);
    expect(e).toBeInstanceOf(HttpException);
    expect((e as HttpException).getStatus()).toBe(403);
    expect((e as HttpException).getResponse()).toMatchObject({ code: 'disabled' });
    const noBranch = harness({ start: async () => { throw new GoCheckInError('This display is not assigned to a branch.', 409, 'no_branch'); } });
    expect(await status(() => noBranch.ctl.deviceCheckInSession(dev('front-token')))).toBe(409);
    expect(await status(() => harness().ctl.deviceCheckInSession(dev('forged-token')))).toBe(403);
    expect(await status(() => harness().ctl.deviceCheckInSession(dev('serviced-token')))).toBe(403);
  });
});

// POSLanguage.pdf §16 (Oct 28 2026): the Customer Display is ENGLISH ONLY — the state always says ['en'], even when the
// salon's settings (or an older port) list Vietnamese first.
describe('the display\'s language (POSLanguage.pdf §16)', () => {
  it('English only, whatever the salon\'s list says', async () => {
    expect((await harness({ languages: async () => ['vi', 'en'] }).svc.getDeviceState('front-token')).languages).toEqual(['en']);
    expect((await harness({ languages: async () => { throw new Error('db down'); } }).svc.getDeviceState('front-token')).languages).toEqual(['en']);
    expect((await harness().svc.getDeviceState('front-token')).languages).toEqual(['en']);
  });
});
