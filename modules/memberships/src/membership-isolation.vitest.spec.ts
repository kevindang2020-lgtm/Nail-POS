// membership-isolation.vitest.spec.ts — static tenant-isolation guard. It reads the membership Kysely repository sources
// and asserts that EVERY SQL statement touching a tenant-owned membership table is scoped by tenant_id. The only
// exceptions are a small, explicitly documented allowlist of statements that are provably safe by other means (UUID
// primary-key updates on the system billing surface, and a version-sequence read that is gated by an immediately-preceding
// tenant ownership check). If a future change adds an unscoped query, this test fails and names the offending statement.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const DIR = __dirname;
const TENANT_TABLES = [
  'membership_plans', 'membership_plan_versions', 'membership_benefits', 'customer_memberships',
  'membership_credit_ledger', 'membership_payments', 'membership_redemptions', 'membership_activity',
  'membership_audit', 'customer_notifications', 'compensation_adjustments',
];

// Documented safe-by-other-means statements (normalized substring match). Keep this list tight and justified.
const ALLOWLIST: { sig: string; why: string }[] = [
  { sig: 'update customer_memberships set status', why: 'billing engine: update by UUID PK (where id = ${membershipId}); system/scheduler surface, membershipId from tenant-correct reads' },
  { sig: 'coalesce(max(version_number), 0) + 1 as v from membership_plan_versions where plan_id', why: 'version sequence; the plan is verified to belong to ctx.tenantId on the immediately preceding line inside the same transaction' },
];

function sqlBlocks(src: string): string[] {
  const out: string[] = [];
  const re = /sql<[^>]*>`([\s\S]*?)`|sql`([\s\S]*?)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push((m[1] || m[2] || '').replace(/\s+/g, ' ').trim());
  return out;
}

describe('Membership tenant isolation (static)', () => {
  const repoFiles = readdirSync(DIR).filter((f) => f.endsWith('.kysely.repository.ts'));

  it('covers all membership Kysely repositories', () => {
    expect(repoFiles.length).toBeGreaterThanOrEqual(4);
  });

  const offenders: string[] = [];
  for (const file of repoFiles) {
    const src = readFileSync(join(DIR, file), 'utf8');
    for (const q of sqlBlocks(src)) {
      const ql = q.toLowerCase();
      if (!TENANT_TABLES.some((t) => new RegExp(`\\b${t}\\b`).test(ql))) continue; // not a tenant-table query
      if (ql.includes('tenant_id')) continue;                                       // scoped — good
      if (ALLOWLIST.some((a) => ql.includes(a.sig))) continue;                       // documented safe
      offenders.push(`[${file}] ${q.slice(0, 120)}`);
    }
  }

  it('has no unscoped membership-table query outside the documented allowlist', () => {
    expect(offenders).toEqual([]);
  });
});
