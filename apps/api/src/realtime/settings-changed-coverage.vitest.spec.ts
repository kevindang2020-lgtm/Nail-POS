// settings-changed-coverage.vitest.spec — the guard that keeps settings_updated honest.
//
// The canonical fact is "a row in tenant_settings changed". Every file that writes that table must announce it,
// or the owner dashboard silently stops refreshing for that kind of change. This test finds every writer and fails
// if one does not call notifySettingsChanged.
//
// The match is CASE-INSENSITIVE on purpose. While wiring this I listed "exactly five" writers from a
// case-sensitive grep; there were six — ai-settings-store.ts writes with lowercase `insert into`. A guard with the
// same blind spot would miss exactly that file.
import { codeRoots, codeKey, sourcePath } from '../../test-support/code-roots';
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');
const WRITE = /(insertInto|updateTable)\(\s*['"`]tenant_settings['"`]|\b(insert\s+into|update)\s+tenant_settings\b/i;

/**
 * Files whose WRITE lives in a repository but whose NOTIFICATION belongs to the service calling it, because only
 * the service knows the write succeeded. Each entry names the notifier, which the second test then checks.
 */
const DELEGATED: Record<string, { notifier: string; call: RegExp }> = {
  'settings/settings.kysely.repository.ts': { notifier: 'settings/settings.service.ts', call: /this\.repo\.saveCategory\(/g },
  // 23-inch dual-screen spec §111: Customer Display Advertising's salon / branch settings (category customer-display-ads)
  'display-advertising/display-ads.repository.ts': { notifier: 'display-advertising/display-ads.service.ts', call: /this\.repo\.saveSettings\(/g },
  // 23-inch dual-screen spec §13: the salon logo row (category salon-logo) — written only by the logo upload / remove
  'settings/salon-logo.ts': { notifier: 'settings/settings.service.ts', call: /this\.logos\.(put|clear)\(/g },
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(p) && !p.endsWith('kysely.types.ts')) out.push(p);
  }
  return out;
}

// Keyed by codeKey (a grouped module keeps '<dir>/<file>'), so the DELEGATED register below survives a directory moving
// into a module (Constitution 13) — settings/ moving into modules/tenants broke the relative-path keys once.
const writerFiles = new Map(codeRoots().flatMap((r) => walk(r)).filter((f) => WRITE.test(readFileSync(f, 'utf8'))).map((f) => [codeKey(f), f] as const));
const writers = [...writerFiles.keys()];

describe('every tenant_settings writer announces the change', () => {
  it('finds the writers at all — a guard that matches nothing guards nothing', () => {
    expect(writers.length).toBeGreaterThanOrEqual(6);
  });

  it('including the lowercase-SQL writer a case-sensitive search missed', () => {
    // writers are relative to apps/api/src; the AI domain is modules/ai now (Constitution 13), so match the tail
    expect(writers.some((w) => w.endsWith('ai/ai-settings-store.ts'))).toBe(true);
  });

  for (const w of writers) {
    it(`${w} calls notifySettingsChanged (or is delegated to a service that does)`, () => {
      const src = readFileSync(writerFiles.get(w)!, 'utf8');
      const ok = src.includes('notifySettingsChanged(') || w in DELEGATED;
      expect(ok, `${w} writes tenant_settings but never calls notifySettingsChanged`).toBe(true);
    });
  }

  it('each delegated notifier emits after EVERY call into the write — not just the first', () => {
    for (const [, d] of Object.entries(DELEGATED)) {
      const src = readFileSync(sourcePath(d.notifier), 'utf8');
      const calls = (src.match(d.call) || []).length;
      const notifies = (src.match(/notifySettingsChanged\(/g) || []).length;
      expect(calls).toBeGreaterThan(0);
      expect(notifies, `${d.notifier}: ${calls} writes but only ${notifies} notifications`).toBeGreaterThanOrEqual(calls);
    }
  });
});
