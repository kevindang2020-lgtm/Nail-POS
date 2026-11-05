// db-ownership.vitest.spec.ts — BUILD_PLAN Phase 10 (Constitution 1 §3): the ownership registry's rules and drift check,
// and one real-schema assertion — the committed registry classifies every table the migrations create.
import { describe, it, expect } from 'vitest';
import { migratedPglite } from '@aipowersalon/testing';
// plain ESM helpers shared with the CLI (no type declarations)
const { buildRegistry, ruleViolations, registryDrift, introspect }: any = await import('../../db/ownership/registry.mjs');
const { ownershipOf, domainOf }: any = await import('../../db/ownership/heuristics.mjs');
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const fact = (table: string, cols: Record<string, boolean>, extra: Partial<{ append_only: boolean; frozen: boolean }> = {}) =>
  ({ table, columns: new Map(Object.entries(cols).map(([c, nullable]) => [c, { nullable }])), append_only: false, frozen: false, ...extra });

describe('ownership heuristics (§3)', () => {
  it('classes by shape: no tenant → A, tenant → B, tenant + NOT NULL branch → C, identity link → D, other-tenant column → E', () => {
    expect(ownershipOf(fact('platform_settings', { id: false }))).toBe('A');
    expect(ownershipOf(fact('services', { id: false, tenant_id: false, branch_id: true }))).toBe('B');
    expect(ownershipOf(fact('pos_queue_items', { id: false, tenant_id: false, branch_id: false }))).toBe('C');
    expect(ownershipOf(fact('tech_salon_memberships', { id: false, tenant_id: false, global_tech_profile_id: false }))).toBe('D');
    expect(ownershipOf(fact('customer_identities', { id: false }))).toBe('D');
    expect(ownershipOf(fact('gift_card_programs', { id: false, owner_tenant_id: false }))).toBe('E');
  });
  it('domain by name, null when nothing matches', () => {
    expect(domainOf('payments')).toBe('PAYMENTS');
    expect(domainOf('pos_tech_appointments')).toBe('BOOKING');
    expect(domainOf('zz_unheard_of')).toBeNull();
  });
});

describe('ruleViolations', () => {
  it('fails an unclassified table, B/C without tenant_id, C without branch_id, A with tenant_id, a stale or reason-less override', () => {
    const reg = buildRegistry([
      fact('zz_unheard_of', { id: false }),
      fact('services', { id: false }),
      fact('pos_queue_items', { id: false, tenant_id: false }),
      fact('platform_settings', { id: false, tenant_id: true }),
    ], { tables: {
      services: { ownership: 'B', reason: 'tenant catalog' },
      pos_queue_items: { ownership: 'C', reason: 'branch queue rows' },
      platform_settings: { ownership: 'A', reason: 'platform settings' },
      gone_table: { ownership: 'A', reason: 'was dropped' },
      zz_unheard_of: { ownership: 'A' },
    } });
    const errs = ruleViolations(reg, { tables: { gone_table: { ownership: 'A', reason: 'was dropped' }, zz_unheard_of: { ownership: 'A' } } }).join('\n');
    expect(errs).toMatch(/zz_unheard_of: no domain/);
    expect(errs).toMatch(/services: tenant_owned but has no tenant_id/);
    expect(errs).toMatch(/pos_queue_items: tenant_branch_owned but has no branch_id/);
    expect(errs).toMatch(/platform_settings: platform_global but has tenant_id/);
    expect(errs).toMatch(/gone_table is not a table any more/);
    expect(errs).toMatch(/zz_unheard_of needs a reason/);
  });
  it('a clean registry has no violations', () => {
    const reg = buildRegistry([fact('payments', { id: false, tenant_id: false, branch_id: false })]);
    expect(ruleViolations(reg)).toEqual([]);
    expect(reg.payments).toMatchObject({ ownership: 'tenant_branch_owned', domain: 'PAYMENTS', has_tenant_id: true, has_branch_id: true, retention_class: 'indefinite', delete_policy: 'none' });
  });
  it('retention_class / delete_policy come from the retention policy file', () => {
    const reg = buildRegistry([fact('password_reset_tokens', { id: false, tenant_id: true })], {}, { tables: { password_reset_tokens: { retention_class: 'temporary', delete_policy: 'hard_delete_after_days' } } });
    expect(reg.password_reset_tokens).toMatchObject({ retention_class: 'temporary', delete_policy: 'hard_delete_after_days', platform_rows: true });
  });
});

describe('registryDrift', () => {
  it('a new table, a dropped table and a changed fact are each a failure', () => {
    const a = buildRegistry([fact('payments', { id: false, tenant_id: false, branch_id: false }), fact('old_t', { id: false })], { tables: { old_t: { domain: 'PLATFORM', reason: 'test fixture' } } });
    const b = buildRegistry([fact('payments', { id: false, tenant_id: false }), fact('new_things', { id: false })], { tables: { new_things: { domain: 'PLATFORM', reason: 'test fixture' } } });
    const d = registryDrift(a, b).join('\n');
    expect(d).toMatch(/new_things: new table not in the registry/);
    expect(d).toMatch(/old_t: in the registry but no longer a table/);
    expect(d).toMatch(/payments\.has_branch_id/);
    expect(registryDrift(b, b)).toEqual([]);
  });
});

describe('the committed registry against the real schema', () => {
  it('introspect sees append-only triggers / rules and every migrated table is in the committed registry with a class and a domain', async () => {
    const pg = await migratedPglite();
    const facts = await introspect(pg);
    const by = new Map(facts.map((f: any) => [f.table, f]));
    expect(by.get('audit_events').append_only).toBe(true);
    expect(by.get('appointment_change_log').append_only).toBe(true);   // DO INSTEAD NOTHING rule
    expect(by.get('payments').append_only).toBe(false);
    const committed = JSON.parse(readFileSync(join(__dirname, '..', '..', 'db', 'ownership', 'registry.generated.json'), 'utf8')).tables;
    const missing = facts.map((f: any) => f.table).filter((t: string) => !committed[t] || !committed[t].ownership || !committed[t].domain);
    expect(missing).toEqual([]);
  }, 300_000);
});
