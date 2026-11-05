// realtime-catalog-gate.vitest.spec.ts — Phase 15: the realtime event catalog generator (Constitution 9 §247) is a GATE
// (check:realtime-catalog in tooling/ci/run-gates.mjs). Ten events (schedule_*, community_*, approval_updated,
// authorization_changed) had shipped as UNCLASSIFIED — a footnote nobody read. Now: the real registry classifies
// completely and the committed catalog is current; an event in a new domain, or a stale committed catalog, exits 1.
// The negative cases run the real script against a mirrored repo tree in a temp dir (the script resolves its root from
// its own location), so nothing in the working tree is touched.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../..');
const SCRIPT = 'apps/api/scripts/generate-realtime-catalog.mjs';
const CORE = 'packages/realtime-contracts/src/realtime-core.ts';
const CLIENT = 'packages/realtime-client/src/client.ts';
const run = (root: string, ...args: string[]) => spawnSync(process.execPath, [join(root, SCRIPT), ...args], { encoding: 'utf8' });

let tmp: string;
const mirror = () => {
  for (const f of [SCRIPT, CORE, CLIENT, 'REALTIME_EVENT_CATALOG.md']) { mkdirSync(join(tmp, f, '..'), { recursive: true }); copyFileSync(join(ROOT, f), join(tmp, f)); }
};
beforeAll(() => { tmp = mkdtempSync(join(tmpdir(), 'rt-catalog-')); mirror(); });
afterAll(() => { if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true }); });

describe('realtime catalog gate', () => {
  it('the real registry: every event classified, committed catalog current → --check exits 0', () => {
    const r = run(ROOT, '--check');
    expect(r.stderr).not.toMatch(/UNCLASSIFIED|stale/);
    expect(r.status).toBe(0);
    expect(readFileSync(join(ROOT, 'REALTIME_EVENT_CATALOG.md'), 'utf8')).not.toContain('UNCLASSIFIED');
  });
  it('the ten formerly unclassified events now carry their audience / permission / payload class', () => {
    const md = readFileSync(join(ROOT, 'REALTIME_EVENT_CATALOG.md'), 'utf8');
    for (const name of ['schedule_recommendation_updated', 'schedule_run_completed', 'schedule_settings_changed', 'schedule_proposal_updated',
      'community_post_updated', 'community_comment_added', 'community_alert', 'community_settings_changed', 'approval_updated', 'authorization_changed']) {
      const line = md.split('\n').find((l) => l.startsWith(`| \`${name}\` |`));
      expect(line, name).toBeTruthy();
      expect(line).toMatch(/Signal only/);
      expect(line).toMatch(/pos\.login/);
    }
  });
  it('an event in a NEW domain → generator and --check both exit 1, naming it', () => {
    mirror();
    const core = join(tmp, CORE);
    const src = readFileSync(core, 'utf8');
    const i = src.indexOf('export const EVENTS = {');
    writeFileSync(core, src.slice(0, i) + 'export const EVENTS = {\n  zzzBrandNew: "zzz_brand_new_thing",' + src.slice(i + 'export const EVENTS = {'.length));
    const gen = run(tmp);
    expect(gen.status).toBe(1);
    expect(gen.stderr).toContain('zzz_brand_new_thing');
    expect(run(tmp, '--check').status).toBe(1);
  });
  it('a stale committed catalog → --check exits 1 (and writes nothing)', () => {
    mirror();
    const out = join(tmp, 'REALTIME_EVENT_CATALOG.md');
    writeFileSync(out, readFileSync(out, 'utf8') + '\nhand edit\n');
    const before = readFileSync(out, 'utf8');
    const r = run(tmp, '--check');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/stale/);
    expect(readFileSync(out, 'utf8')).toBe(before);
  });
});
