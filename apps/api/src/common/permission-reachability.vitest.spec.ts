// permission-reachability.vitest.spec.ts — codebase-audit guard (2026-07-09).
//
// Invariant: every permission KEY used by a real gate (@RequirePermission, service .need(ctx, key),
// requirePermission(key), or an inline hasPermission(ctx, key)) must be GRANTABLE by at least one role.
// A gate whose requiredCapability() target no role holds is a silent 403 for EVERY user — including OWNER.
// This is precisely the class of bug that hit the marketing/inventory surface (fixed in the four-package merge)
// and the Communications / Payroll / tenant-Audit surfaces (fixed in this audit). Frontend tests mock the API
// client and the DI graph check never exercises a token, so nothing else catches an unreachable gate. This does.
//
// "Grantable" = some role R satisfies hasPermission({ role: R, permissions: permissionsFor(R) }, key):
//   - tenant keys  -> some non-SUPER_ADMIN role (a key may be intentionally OWNER-only or MANAGER-only; the
//                     invariant is "at least one role", never "all roles").
//   - super_admin.* keys -> SUPER_ADMIN (they are minted into the SA token from rbac and gated by SuperAdminGuard).
import { permissionsFor, type Role, hasPermission } from '@aipowersalon/permissions';
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { codeRoots } from '../../test-support/code-roots';   // Constitution 13: gates in modules count too
import { join } from 'node:path';

const GATE_PATTERNS = [
  /@RequirePermission\('([^']+)'\)/g,
  /\.need\(\s*[a-zA-Z_][\w.]*\s*,\s*'([^']+)'\)/g,
  /\brequirePermission\('([^']+)'\)/g,
  /\bhasPermission\([^,]+,\s*'([^']+)'\)/g,
];

// Skip comment lines so a doc example like `// @RequirePermission('checkout.take_payment')` is not mistaken for a
// live gate (the two known false positives are both full-line comments).
function isCommentLine(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

function collectGateKeys(dir: string, acc: Set<string>): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name !== 'node_modules' && name !== 'dist') collectGateKeys(p, acc);
      continue;
    }
    if (!name.endsWith('.ts') || name.endsWith('.spec.ts') || name.endsWith('.test.ts') || name.endsWith('.d.ts')) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      if (isCommentLine(line)) continue;
      for (const re of GATE_PATTERNS) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(line))) acc.add(m[1]);
      }
    }
  }
}

const TENANT_ROLES: Role[] = ['OWNER', 'MANAGER', 'FRONT_DESK', 'RECEPTION', 'TECHNICIAN', 'CUSTOMER'];
const ctx = (role: Role) => ({ role, tenantId: 't', branchId: 'b', userId: 'u', permissions: permissionsFor(role) });
function reachable(key: string): boolean {
  if (key.startsWith('super_admin.')) return hasPermission(ctx('SUPER_ADMIN') as any, key);
  return TENANT_ROLES.some((r) => hasPermission(ctx(r) as any, key));
}

// Keys that are intentionally not grantable by any role today (future features gated ahead of their rollout).
// Keep empty; add here only with a written justification if such a case ever arises.
const ALLOW_UNREACHABLE = new Set<string>([]);

describe('permission gate reachability', () => {
  const keys = new Set<string>();
  for (const r of codeRoots()) collectGateKeys(r, keys);

  it('collected a meaningful number of gate keys (scan sanity)', () => {
    expect(keys.size).toBeGreaterThan(150);
  });

  it('every permission gate is grantable by at least one role (no all-role 403)', () => {
    const unreachable = [...keys].filter((k) => !reachable(k) && !ALLOW_UNREACHABLE.has(k)).sort();
    expect(unreachable).toEqual([]);
  });

  it('the previously-broken surfaces stay reachable (regression pins)', () => {
    for (const k of ['audit.view', 'pos.communications.view', 'pos.communications.send', 'pos.communications.manage',
                     'pos.payroll.view', 'pos.payroll.manage', 'pos.marketing.view', 'pos.marketing.manage']) {
      expect(reachable(k), k).toBe(true);
    }
  });

  it('MANAGER can VIEW every AI module shown in the AI CENTER sidebar section (roles: MGMT)', () => {
    // The AI CENTER nav section is roles: MGMT (OWNER+MANAGER). Package B's three AI modules (queue, money-protection,
    // voice) once granted MANAGER nothing, so a manager saw those items and 403'd. These pins keep MANAGER's read-tier
    // in place. Sensitive mutations intentionally stay owner-gated and are NOT pinned here.
    const mgr = ctx('MANAGER');
    for (const k of ['pos.ai_business.view', 'pos.ai_inventory.view', 'pos.ai_analytics.view',
                     'pos.ai_customer_profile.view', 'pos.ai_checkout_upsell.view', 'pos.ai_review_reputation.view',
                     'ai_scheduling.view', 'pos.ai_ocr_receipt.view',
                     'ai_queue_assignment.view', 'ai_money_protection.view', 'ai_money_protection.view_alerts',
                     'ai_voice_transcription.view', 'ai_voice_transcription.view_transcripts']) {
      expect(hasPermission(mgr as any, k), `MANAGER should view ${k}`).toBe(true);
    }
  });
});
