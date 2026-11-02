// technicians-permissions-core.vitest.spec.ts — the function that decides what a technician may do.
//
// It sits on the path that mints a session, so it is the last thing standing between a corrupt
// `technician_permissions` row and a technician holding authority nobody granted them.
import { describe, it, expect } from 'vitest';
import { sanitizeTechPermissions } from './technicians.dto';
import { effectiveTechPermissions, TECH_PERMISSION_KEYS } from '@aipowersalon/permissions';

const ROLE_DEFAULTS = [
  'pos.tech.view_schedule', 'pos.tech.accept_ticket', 'pos.tech.start_service',
  'pos.tech.mark_done', 'pos.tech.request_break', 'pos.tech.view_earnings',
];

describe('effectiveTechPermissions', () => {
  it('no overrides → exactly the role defaults', () => {
    expect(effectiveTechPermissions(ROLE_DEFAULTS, [])).toEqual([...ROLE_DEFAULTS].sort());
  });

  it('a salon may GRANT something the role does not', () => {
    const out = effectiveTechPermissions(ROLE_DEFAULTS, [{ permission: 'pos.tech.process_payment', allowed: true }]);
    expect(out).toContain('pos.tech.process_payment');
  });

  it('a salon may REVOKE a role default — which a set of granted keys could never express', () => {
    const out = effectiveTechPermissions(ROLE_DEFAULTS, [{ permission: 'pos.tech.view_earnings', allowed: false }]);
    expect(out).not.toContain('pos.tech.view_earnings');
    expect(out).toContain('pos.tech.accept_ticket');
  });

  it('THE ESCALATION GUARD: a permission outside the technician vocabulary goes nowhere', () => {
    // However the row got into the table — a future bug, a bad migration, a compromised write — it is IGNORED,
    // not honoured. The function does not trust its own table.
    const out = effectiveTechPermissions(ROLE_DEFAULTS, [
      { permission: 'super_admin.all', allowed: true },
      { permission: 'pos.technicians.commission.edit', allowed: true },
      { permission: 'billing.refund.issue', allowed: true },
      { permission: '*', allowed: true },
    ]);
    expect(out).toEqual([...ROLE_DEFAULTS].sort());
    for (const p of out) expect(TECH_PERMISSION_KEYS as readonly string[]).toContain(p);
  });

  it('a granted-then-revoked key ends revoked — last write in the list wins, deterministically', () => {
    const out = effectiveTechPermissions(ROLE_DEFAULTS, [
      { permission: 'pos.tech.process_payment', allowed: true },
      { permission: 'pos.tech.process_payment', allowed: false },
    ]);
    expect(out).not.toContain('pos.tech.process_payment');
  });

  it('is stable and deduplicated — the same inputs mint the same session, every time', () => {
    const a = effectiveTechPermissions([...ROLE_DEFAULTS, 'pos.tech.accept_ticket'], [{ permission: 'pos.tech.mark_done', allowed: true }]);
    const b = effectiveTechPermissions(ROLE_DEFAULTS, [{ permission: 'pos.tech.mark_done', allowed: true }]);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });

  it('survives junk without widening anything', () => {
    expect(effectiveTechPermissions(ROLE_DEFAULTS, undefined as any)).toEqual([...ROLE_DEFAULTS].sort());
    expect(effectiveTechPermissions([], [{ permission: 'super_admin.all', allowed: true }])).toEqual([]);
  });

  it('agrees with sanitizeTechPermissions about what a technician permission even IS', () => {
    // Two gates, one vocabulary. If they ever disagreed, the write gate would accept a key the read gate drops —
    // a manager would toggle something, see it saved, and it would silently never apply.
    const { matrix, rejected } = sanitizeTechPermissions([
      { permission: 'pos.tech.process_payment', allowed: true },
      { permission: 'super_admin.all', allowed: true },
    ]);
    expect(rejected).toEqual(['super_admin.all']);
    expect(effectiveTechPermissions(ROLE_DEFAULTS, matrix)).toContain('pos.tech.process_payment');
  });
});
