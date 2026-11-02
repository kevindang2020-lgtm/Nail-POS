// glossary.test — English + Vietnamese POS mandate §28–§37 (build plan WP-D1). Each term in docs/i18n/VI_GLOSSARY.md
// resolves in the app to the approved Vietnamese; the generated catalogue's glossary terms use it too; technician = "Thợ".
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { setLanguage, t } from '@aipowersalon/mobile-sdk/i18n';
import './index';
import { POS_EN } from './catalog.en';
import { POS_VI } from './catalog.vi';

const ROOT = resolve(process.cwd(), '../..') + '/';   // vitest runs in apps/pos-web
const doc = readFileSync(ROOT + 'docs/i18n/VI_GLOSSARY.md', 'utf8');
const rows = [...doc.matchAll(/^\|\s*`(glossary\.[\w.]+)`\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/gm)].map((m) => ({ key: m[1], en: m[2], vi: m[3] }));

afterEach(async () => { await setLanguage('en'); });

describe('the product glossary (§37)', () => {
  it('lists the mandate terms (§28–§34 + §37)', () => {
    expect(rows.length).toBeGreaterThanOrEqual(90);
    const en = rows.map((r) => r.en);
    for (const term of ['Overview', 'Tech Queue', 'Take Payment', 'Technician', 'Appointment', 'Queue Hold', 'Balance Due', 'Verify Payment', 'Ready for Checkout', 'Fair Turn'])
      expect(en, term).toContain(term);
  });
  it('each glossary entry resolves to the approved Vietnamese in the app', async () => {
    for (const r of rows) expect(t(r.key), r.key).toBe(r.en);
    await setLanguage('vi');
    for (const r of rows) expect(t(r.key), r.key).toBe(r.vi);
  });
  it('Kevin\'s ruling: technician = "Thợ"', async () => {
    await setLanguage('vi');
    expect(t('glossary.people.technician')).toBe('Thợ');
    expect(t('glossary.nav.techQueue')).toBe('Hàng chờ thợ');
    expect(t('glossary.action.assignTech')).toBe('Chỉ định thợ');
    expect(Object.values(POS_VI).filter((v) => /kỹ thuật viên|\bKTV\b/i.test(v))).toEqual([]);
  });
  it('the generated catalogue shows the glossary term wherever its English is that term', () => {
    const term = new Map(rows.map((r) => [r.en.toLowerCase(), r.vi]));
    const caseLike = (en: string, vi: string) => (en === en.toUpperCase() && /[A-Z]/.test(en) ? vi.toUpperCase() : /^[a-z]/.test(en) ? vi[0].toLowerCase() + vi.slice(1) : vi);
    const wrong = Object.entries(POS_EN).filter(([k, en]) => k !== 'pos.tq_status_break' && term.has(en.trim().toLowerCase())
      && (POS_VI as Record<string, string>)[k] !== caseLike(en.trim(), term.get(en.trim().toLowerCase())!));
    expect(wrong).toEqual([]);
  });
  it('the gate tooling/ci/check-vi-glossary.mjs passes', () => {
    const out = execFileSync('node', [ROOT + 'tooling/ci/check-vi-glossary.mjs'], { encoding: 'utf8' });
    expect(out).toContain('vi-glossary');
  });
});
