// customer-phone-settings.vitest.spec.ts
//
// Two of these settings are not preferences. They decide who can move a customer's phone number, and how — which
// means they decide where that customer's booking codes and appointment reminders are delivered.
import { permissionsFor } from '@aipowersalon/permissions';
import { describe, it, expect } from 'vitest';
import {
  CustomerPhoneSettingsService, PhoneSettingsError, PHONE_SETTINGS_DEFAULTS,
  type PhoneSettingsStore,
} from './customer-phone-settings.service';
import type { PhoneSettings } from './customer-phone-update.service';

function build(current?: Partial<PhoneSettings>) {
  const writes: PhoneSettings[] = [];
  const audits: any[] = [];
  const store: PhoneSettingsStore = {
    async get() { return current ? { ...PHONE_SETTINGS_DEFAULTS, ...current } : null; },
    async upsert(_t, _b, s) { writes.push(s); },
  };
  const svc = new CustomerPhoneSettingsService(store, { async record(a) { audits.push(a); } });
  return { svc, writes, audits };
}

// BUILD_PLAN Phase 9: actors carry their role's real session permissions — the service decides by permission now.
const owner = { tenantId: 't1', branchId: null, userId: 'u1', role: 'OWNER', permissions: permissionsFor('OWNER') };
const manager = { ...owner, role: 'MANAGER', permissions: permissionsFor('MANAGER') };
const reception = { ...owner, role: 'RECEPTION', permissions: permissionsFor('RECEPTION') };

describe('manual confirmation is OFF by default, and that is deliberate', () => {
  it('defaults to false', async () => {
    // A "manually confirmed" number is a manager's JUDGEMENT, not cryptographic evidence. Defaulting this ON would
    // quietly turn every salon into one where a phone can be marked usable without anybody ever proving it.
    expect(PHONE_SETTINGS_DEFAULTS.allowManualConfirmation).toBe(false);
    const { svc } = build();
    expect((await svc.get('t1', null)).allowManualConfirmation).toBe(false);
  });

  it('a tenant may turn it on — deliberately, and it is audited', async () => {
    const { svc, writes, audits } = build();
    const r = await svc.update(owner, { allowManualConfirmation: true });
    expect(r.allowManualConfirmation).toBe(true);
    expect(writes[0].allowManualConfirmation).toBe(true);
    // Recorded, because it changes who can mark a number usable without an SMS.
    expect(audits[0].metadata.allowManualConfirmation).toBe(true);
  });
});

describe('who may change the rules', () => {
  it('REFUSES a receptionist', async () => {
    // A receptionist changing the rules that constrain receptionists is not a permission model. And a receptionist
    // is exactly who a social engineer calls — so `allowReceptionistUpdates` is a real control, and its own subject
    // must not be able to switch it back on.
    const { svc, writes } = build();
    await expect(svc.update(reception, { allowReceptionistUpdates: true })).rejects.toBeInstanceOf(PhoneSettingsError);
    expect(writes).toHaveLength(0);
  });

  it('allows an owner or a manager', async () => {
    for (const actor of [owner, manager]) {
      const { svc, writes } = build();
      await svc.update(actor, { allowSharedFamilyPhones: false });
      expect(writes, actor.role).toHaveLength(1);
    }
  });
});

describe('SMS verification OFF is a SUPPORTED configuration', () => {
  it('a salon may turn SMS verification off — and this used to be REFUSED', () => {
    // The earlier version of this service refused it, on the grounds that "no number could ever be verified".
    // That was wrong, and wrong in an expensive direction.
    //
    // The customer is STANDING AT THE COUNTER reading their new number to a receptionist who is looking at them.
    // Forcing an OTP there protects against nothing — and it is friction a busy salon routes around, by writing the
    // number in a note field or not updating it at all, which is worse than either option on the table.
    //
    // Verification does not disappear; it moves to where it actually protects something. A staff change produces
    // `active_unverified`, which CANNOT satisfy the booking gate — so the next remote booking sends a code.
    // Verification happens at BOOKING, which is the only place a fake number does real damage.
    expect(true).toBe(true);
  });

  it('allows SMS off with manual confirmation ALSO off', async () => {
    const { svc, writes } = build({ allowManualConfirmation: false });
    await svc.update(owner, { requireSmsVerification: false });
    expect(writes).toHaveLength(1);
    expect(writes[0].requireSmsVerification).toBe(false);
  });

  it('allows SMS off with manual confirmation on', async () => {
    const { svc, writes } = build({ allowManualConfirmation: true });
    await svc.update(owner, { requireSmsVerification: false });
    expect(writes[0].requireSmsVerification).toBe(false);
  });

  it('and the normal case still works', async () => {
    const { svc, writes } = build();
    await svc.update(owner, { requireSmsVerification: true, allowManualConfirmation: false });
    expect(writes).toHaveLength(1);
  });
});

describe('the audit record', () => {
  it('carries the SECURITY-relevant switches, and no phone number', async () => {
    const { svc, audits } = build();
    await svc.update(owner, { allowReceptionistUpdates: false });
    expect(audits[0].action).toBe('phone_settings_changed');
    expect(audits[0].metadata.allowReceptionistUpdates).toBe(false);
    expect(JSON.stringify(audits[0])).not.toMatch(/\d{7,}/);
  });
});

describe('Phase 3 (audit E10): a branch’s own policy is reachable, and only for this salon’s branches', () => {
  function withBranches(own: string[] = []) {
    const writes: any[] = []; const deleted: string[] = [];
    const store: PhoneSettingsStore = {
      async get() { return null; },
      async upsert(_t, b, s) { writes.push({ b, s }); },
      async getOwn(_t, b) { return own.includes(b) ? PHONE_SETTINGS_DEFAULTS : null; },
      async branchBelongs(_t, b) { return b === 'b-mine' || b === 'b-own'; },
      async deleteBranch(_t, b) { deleted.push(b); return true; },
    };
    return { svc: new CustomerPhoneSettingsService(store), writes, deleted };
  }
  it('saves a branch override for one of this salon’s branches', async () => {
    const { svc, writes } = withBranches();
    await svc.update({ ...manager, branchId: 'b-mine' }, { requireManagerApproval: true });
    expect(writes[0]).toMatchObject({ b: 'b-mine', s: { requireManagerApproval: true } });
  });
  it('refuses another salon’s branch (not found)', async () => {
    const { svc, writes } = withBranches();
    await expect(svc.update({ ...manager, branchId: 'b-theirs' }, { requireManagerApproval: true })).rejects.toMatchObject({ code: 'not_found' });
    await expect(svc.getBranch('t1', 'b-theirs')).rejects.toMatchObject({ code: 'not_found' });
    expect(writes).toHaveLength(0);
  });
  it('reports whether the branch has its own override, and can remove it', async () => {
    const { svc, deleted } = withBranches(['b-own']);
    expect((await svc.getBranch('t1', 'b-own')).branchOverride).toBe(true);
    expect((await svc.getBranch('t1', 'b-mine')).branchOverride).toBe(false);
    await expect(svc.clearBranch({ ...reception, branchId: 'b-own' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(await svc.clearBranch({ ...manager, branchId: 'b-own' })).toEqual({ ok: true, removed: true });
    expect(deleted).toEqual(['b-own']);
  });
  it('a body is not a settings row: unknown keys and non-booleans are ignored', async () => {
    const { svc, writes } = withBranches();
    await svc.update({ ...manager, branchId: 'b-mine' }, { allowManualConfirmation: 'yes', tenantId: 'other', requireReauthentication: false } as any);
    expect(writes[0].s.allowManualConfirmation).toBe(false);
    expect(writes[0].s.requireReauthentication).toBe(false);
    expect('tenantId' in writes[0].s).toBe(false);
  });
});

describe('Phase 9 — the phone policy is edited by permission (customers.phone_manage), not by role name', () => {
  it('an OWNER-role session with customers.phone_manage DENIED cannot change it; a receptionist granted it can', async () => {
    const store: any = { async get() { return null; }, async upsert() {}, async getBranch() { return null; }, async upsertBranch() {} };
    const svc = new CustomerPhoneSettingsService(store);
    await expect(svc.update({ ...owner, permissions: permissionsFor('OWNER').filter((k) => k !== 'customers.phone_manage') }, {})).rejects.toBeInstanceOf(PhoneSettingsError);
    await expect(svc.update({ ...reception, permissions: [...permissionsFor('RECEPTION'), 'customers.phone_manage'] }, {})).resolves.toBeTruthy();
  });
});

describe('PHONE NUMBER MANAGEMENT 4 · 10 — effective policy explanation (read-only)', () => {
  function store(rows: Record<string, any>) {
    const writes: unknown[] = [];
    const key = (b: string | null) => b ?? 'salon';
    return { writes, s: {
      async get(_t: string, b: string | null) { return rows[key(b)] ?? (b ? rows.salon ?? null : null); },
      async getOwn(_t: string, b: string) { return rows[b] ?? null; },
      async upsert(...a: unknown[]) { writes.push(a); },
    } as any };
  }
  it('nothing saved → every value is the platform default; no Super Admin override is claimed', async () => {
    const { s, writes } = store({});
    const e = await new CustomerPhoneSettingsService(s).explain('t1', null);
    expect(e).toMatchObject({ scope: 'salon', source: 'platform_default', salonPolicySaved: false, superAdminOverride: false });
    expect(e.keys.allowManualConfirmation).toEqual({ value: false, source: 'platform_default', salonValue: null, platformDefault: false, differsFromSalon: false, differsFromDefault: false });
    expect(Object.keys(e.keys)).toHaveLength(9);
    expect(writes).toEqual([]);
  });
  it('a branch without its own row inherits the salon policy; a branch override says which values differ from the salon and the default', async () => {
    const salon = { ...PHONE_SETTINGS_DEFAULTS, requireManagerApproval: true };
    const { s, writes } = store({ salon, 'b-own': { ...salon, requireSmsVerification: false } });
    const svc = new CustomerPhoneSettingsService(s);
    const inh = await svc.explain('t1', 'b-mine');
    expect(inh).toMatchObject({ scope: 'branch', source: 'salon_policy', salonPolicySaved: true });
    expect(inh.keys.requireManagerApproval).toMatchObject({ value: true, source: 'salon_policy', salonValue: true, differsFromSalon: false, differsFromDefault: true });
    const own = await svc.explain('t1', 'b-own');
    expect(own.source).toBe('branch_override');
    expect(own.keys.requireSmsVerification).toMatchObject({ value: false, salonValue: true, platformDefault: true, differsFromSalon: true, differsFromDefault: true });
    expect(own.keys.requireManagerApproval).toMatchObject({ value: true, differsFromSalon: false });
    expect(Object.entries(own.keys).filter(([, v]) => v.differsFromSalon).map(([k]) => k)).toEqual(['requireSmsVerification']);
    expect(writes).toEqual([]);
  });
});
