// BUILD_PLAN Phase 9 (Constitution 2 §148 / §153): the two permission gates added this phase —
//   scripts/check-role-checks.mjs            no role-NAME authorization in backend code beyond the reasoned allowlist
//   tooling/permissions/scan-permission-keys  (check:perms) every SERVICE-level permission key exists in the catalog
import { describe, it, expect } from 'vitest';

const rc: any = await import('../../scripts/check-role-checks.mjs');
const keys: any = await import('../../../../tooling/permissions/scan-permission-keys.mjs');
const scan = (src: string) => rc.scanSource(src, 'x.ts').map((o: any) => o.kind);

describe('check:role-checks — finds role-name comparisons', () => {
  it('equality in either order, any case, any role-ish identifier', () => {
    expect(scan(`if (ctx.role === 'OWNER') return true;`)).toEqual(['equality']);
    expect(scan(`if ('MANAGER' !== actor.role) throw x;`)).toEqual(['equality']);
    expect(scan(`if (r.baseRole == "owner") ok();`)).toEqual(['equality']);
    expect(scan(`const isSa = role === 'SUPER_ADMIN';`)).toEqual(['equality']);
  });
  it('membership: role lists / sets and literal arrays', () => {
    expect(scan(`if (FORBIDDEN_ROLES.includes((ctx.role || '').toUpperCase())) throw e;`)).toEqual(['membership']);
    expect(scan(`if (!APPROVER.has(ctx.role)) return err();`)).toEqual(['membership']);
    expect(scan(`if (['OWNER', 'MANAGER'].includes(u.role)) go();`)).toEqual(['membership']);
    expect(scan(`if (LIST.indexOf(tc.role) >= 0) throw e;`)).toEqual(['membership']);
  });
  it('switch on a role', () => {
    expect(scan(`switch (role) {\n  case 'OWNER': return 1;\n  case 'TECHNICIAN': return 2;\n  default: return 0;\n}`)).toEqual(['switch', 'switch']);
  });
  it('does NOT flag permission checks, comments, other data or a call transcript\'s speakerRole', () => {
    expect(scan(`if (hasPermission(ctx, 'checkout.view')) ok();`)).toEqual([]);
    expect(scan(`if (ctx.permissions.includes('owner.dashboard.view')) ok();`)).toEqual([]);
    expect(scan(`// if (ctx.role === 'OWNER') — the old shortcut`)).toEqual([]);
    expect(scan(`/* role === 'OWNER' */ const a = 1;`)).toEqual([]);
    expect(scan(`if (status === 'owner_pending') go();`)).toEqual([]);
    expect(scan(`if (['front_desk', 'kiosk'].includes(mode)) go();`)).toEqual([]);
    expect(scan(`const asker = s.speakerRole === 'customer';`)).toEqual([]);
    expect(scan(`if (a.includes('role')) cat = 'Role Changes';`)).toEqual([]);
  });
});

describe('check:role-checks — the allowlist is the baseline', () => {
  const occ = [{ file: 'a.ts', line: 1, kind: 'equality', text: "if (ctx.role === 'OWNER') x();" }, { file: 'a.ts', line: 9, kind: 'equality', text: "if (ctx.role === 'OWNER') x();" }];
  it('a new check fails; an entry covering it passes', () => {
    expect(rc.evaluate(occ, []).unlisted.length).toBe(2);
    expect(rc.evaluate(occ, [{ file: 'a.ts', match: "ctx.role === 'OWNER'", count: 2, reason: 'why' }]).unlisted).toEqual([]);
  });
  it('an entry covering MORE occurrences than recorded fails (a second copy of an allowlisted check is new)', () => {
    expect(rc.evaluate(occ, [{ file: 'a.ts', match: "ctx.role === 'OWNER'", count: 1, reason: 'why' }]).over.length).toBe(1);
  });
  it('a reason is required; a whole-file entry is capped by its count; stale entries are reported', () => {
    expect(rc.evaluate(occ, [{ file: 'a.ts', match: 'x', reason: '' }]).malformed.length).toBe(1);
    expect(rc.evaluate(occ, [{ file: 'a.ts', match: '*', count: 2, reason: 'owned elsewhere' }]).unlisted).toEqual([]);
    expect(rc.evaluate(occ, [{ file: 'a.ts', match: '*', count: 1, reason: 'owned elsewhere' }]).over.length).toBe(1);
    expect(rc.evaluate([], [{ file: 'b.ts', match: 'y', reason: 'r' }]).stale.length).toBe(1);
  });
  it('the real tree passes against the committed allowlist, and every entry has a reason', () => {
    const r = rc.evaluate(rc.scanTree(), rc.loadAllowlist());
    expect(r.unlisted.map((o: any) => `${o.file}:${o.line}`)).toEqual([]);
    expect(r.over).toEqual([]);
    expect(r.malformed).toEqual([]);
  });
});

describe('check:perms — service-level permission keys', () => {
  const svc = (src: string) => keys.scanSourceForKeys(src).service;
  it('collects the keys handed to permission helpers', () => {
    expect(svc(`if (!hasPermission(ctx, 'compensation.manage')) throw e;`)).toEqual(['compensation.manage']);
    expect(svc(`this.need(ctx, 'pos.pricing.override');`)).toEqual(['pos.pricing.override']);
    expect(svc(`const ok = (c.permissions || []).includes('ai.control.manage');`)).toEqual(['ai.control.manage']);
    expect(svc(`if (!this.has(ctx, 'pos.checkout.take_payment')) throw e;`)).toEqual(['pos.checkout.take_payment']);
    expect(svc(`requiredPermission: 'pos.schedule.view', effect: 'read'`)).toEqual(['pos.schedule.view']);
    expect(svc(`const VIEW_PERM = 'super_admin.disputes.view';`)).toEqual(['super_admin.disputes.view']);
  });
  it('ignores object lookups, hostnames, the technician-override vocabulary and comments', () => {
    expect(svc(`const v = has(stored, 'display_ads.allowed_mime_types');`)).toEqual([]);
    expect(svc(`if (perms.includes('pos.tech.view_schedule')) ok();`)).toEqual([]);
    expect(svc(`// hasPermission(ctx, 'made.up.key')`)).toEqual([]);
  });
  it('route keys come from @RequirePermission on handlers', () => {
    expect(keys.scanSourceForKeys(`@Get('x') @RequirePermission('pos.customers.view') x() {}`).route).toEqual(['pos.customers.view']);
  });
});
