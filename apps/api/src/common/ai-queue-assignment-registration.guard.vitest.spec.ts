// ai-queue-assignment-registration.guard.vitest.spec.ts — four-package merge, Phase 7 guard.
// History: an early branch registered a SECOND queue package ('ai_queue_assignment') alongside the canonical
// 'ai_queue_technician_assignment', splitting entitlements and tenant subscriptions across two codes. The duplicate was
// reconciled away (2026-07-09 transfer verification); this spec makes the invariant executable so the duplicate — or any
// future double-registration of a catalog code — cannot silently return.
import { codeRoots } from '../../test-support/code-roots';
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AI_PACKAGES, AI_PACKAGE_CODES, isAiPackageCode } from '@aipowersalon/ai';

describe('queue-assignment registration guard (merge Phase 7)', () => {
  it('the catalog registers every package code exactly once (no double-registration of ANY code)', () => {
    const dupes = AI_PACKAGE_CODES.filter((c, i) => AI_PACKAGE_CODES.indexOf(c) !== i);
    expect(dupes).toEqual([]);
  });

  it('exactly ONE queue-assignment package exists and it is the canonical code', () => {
    const queuePkgs = AI_PACKAGES.filter((p) => p.code.includes('queue'));
    expect(queuePkgs.map((p) => p.code)).toEqual(['ai_queue_technician_assignment']);
    expect(isAiPackageCode('ai_queue_assignment')).toBe(false); // the retired duplicate must never be a valid code again
  });

  it('the queue-assignment entitlement gate checks the canonical package code', () => {
    // the AI queue-assignment domain lives in modules/ai (Constitution 13); this guard stays in the API — it walks every code root
    const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'modules', 'ai', 'src', 'ai-queue-assignment', 'ai-queue-assignment-entitlement.ts'), 'utf8');
    expect(src.includes("const PACKAGE = 'ai_queue_technician_assignment'")).toBe(true);
    expect(src.includes("PACKAGE = 'ai_queue_assignment'")).toBe(false);
  });

  it('no source file subscribes/entitles against the retired duplicate code', () => {
    // Scan the api source for the retired code used AS a package code (string literal), excluding rbac permission
    // names (ai_queue_assignment.view etc.), this guard itself, and comments referencing the history.
    const root = path.join(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'dist') walk(p); continue; }
        if (!e.name.endsWith('.ts') || e.name.includes('registration.guard')) continue;
        // `ai/ai-module-registry.ts` is the canonical↔catalog MAPPING table. It names the retired code on purpose,
        // as the left-hand side of the mapping, so that nothing else has to guess which code is live. It never
        // subscribes or entitles against it — it exists so no one else uses the wrong one, which is this guard's
        // intent, not a violation of it.
        if (e.name.startsWith('ai-module-registry')) continue;   // …and its own spec, which necessarily names what it maps
        const src = fs.readFileSync(p, 'utf8');
        // package-code usage looks like the bare quoted code NOT followed by a permission dot-suffix
        if (/['"]ai_queue_assignment['"]/.test(src)) offenders.push(path.relative(root, p));
      }
    };
    for (const r of codeRoots()) walk(r);   // Constitution 13: modules and the API's packages too
    expect(offenders).toEqual([]);
  });
});
