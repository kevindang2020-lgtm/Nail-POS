// incident-vocabulary.vitest.spec — Constitution 12 §195–197: every incident writer speaks the controlled vocabulary.
import { codeRoots, sourcePath } from '../../test-support/code-roots';
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATEGORIES, SEVERITIES, STATUSES, sevLevel } from '@aipowersalon/super-admin';

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : (/\.ts$/.test(f) && !/spec|pgtest|\.d\.ts$/.test(f) ? [p] : []); });

describe('every automatic writer of security_incidents uses a listed category, severity and status', () => {
  // The cross-tenant signal wrote 'cross_tenant_access' and the fraud detector wrote 'fraud' — neither was in the
  // list, so anything filtering by it never showed the two most important kinds of incident.
  const writers = codeRoots().flatMap((r) => walk(r)).map((f) => ({ f, s: readFileSync(f, 'utf8') })).filter((x) => /insert into security_incidents/i.test(x.s));
  it('finds the automatic writers (so this check is not vacuous)', () => expect(writers.length).toBeGreaterThanOrEqual(2));
  it.each(writers.map((w) => [w.f.replace(process.cwd() + '/src/', ''), w.s] as const))('%s', (_f, s) => {
    const values = s.slice(s.search(/insert into security_incidents/i)).match(/values \(([^;]*?)\)\s*(on conflict|returning|`)/i)?.[1] ?? '';
    const literals = [...values.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    // The manual-incident repository passes the category as a PARAMETER (\${i.category}); that path is validated by
    // normalizeCategory in the service — checked below. Automatic writers hard-code a literal; that literal must be listed.
    if (/\$\{i\.category\}/.test(values)) return;
    // BUILD_PLAN Phase 14 C: the observability security signals pass a TYPED category (\${category}: IncidentCategory, derived
    // from CATEGORIES) chosen from a rule table — so every category literal the file hands in must be listed, and there must be some.
    if (/\$\{category\}/.test(values)) {
      expect(s, 'a ${category} parameter must be typed IncidentCategory (typeof CATEGORIES)[number]').toMatch(/category: IncidentCategory/);
      const chosen = [...s.matchAll(/category: '([a-z_]+)'/g), ...s.matchAll(/\.open\('[a-z_]+', '[a-z]+', '([a-z_]+)'/g)].map((m) => m[1]);
      expect(chosen.length).toBeGreaterThan(0);
      for (const c of chosen) expect(CATEGORIES as readonly string[]).toContain(c);
      return;
    }
    const cat = literals.find((l) => (CATEGORIES as readonly string[]).includes(l) || /_access$|fraud|tenant/.test(l));
    expect(cat, `no category literal found in: ${values.slice(0, 120)}`).toBeTruthy();
    expect(CATEGORIES as readonly string[]).toContain(cat);
    for (const st of literals.filter((l) => ['detected', 'investigating', 'contained', 'remediating', 'monitoring', 'closed', 'reopened'].includes(l))) expect(STATUSES as readonly string[]).toContain(st);
  });
});

describe('the manual path normalises its category', () => {
  it('incident.service passes every category through normalizeCategory', () => {
    expect(readFileSync(sourcePath('src/super-admin-security/incident.service.ts'), 'utf8')).toMatch(/normalizeCategory\(/);
  });
});

describe('§196 SEV scale', () => {
  it('critical → SEV1, high → SEV2, medium → SEV3, low/informational → SEV4', () => {
    expect(SEVERITIES.map(sevLevel)).toEqual(['SEV1', 'SEV2', 'SEV3', 'SEV4', 'SEV4']);
  });
});
