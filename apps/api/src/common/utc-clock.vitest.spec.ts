// utc-clock — the API and the worker run on UTC whatever the host is set to (Oct 6 2026; see utc-clock.ts).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const before = process.env.TZ;
afterEach(() => { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; vi.resetModules(); });

// 02:00 UTC on Oct 6 2026 is 10 pm on Oct 5 in New York
const AT = Date.UTC(2026, 9, 6, 2, 0, 0);

describe('the process runs on UTC', () => {
  // a real child process: vitest's module runner hands modules a copy of process.env, so the zone can only be proved
  // in a process of its own (the same way the API starts — this file loaded first)
  it('a host set to New York: once loaded, the evening of Oct 5 there reads as Oct 6, 02:00 — UTC', () => {
    const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '-e',
      `const at = ${AT}; const host = new Date(at).getDate();
       import(${JSON.stringify(join(__dirname, 'utc-clock.ts'))}).then(() => console.log(JSON.stringify({ host, tz: process.env.TZ, day: new Date(at).getDate(), hour: new Date(at).getHours() })));`],
      { env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8', timeout: 30_000 });
    const out = JSON.parse(r.stdout.trim().split('\n').pop() || '{}');
    expect(out).toEqual({ host: 5, tz: 'UTC', day: 6, hour: 2 });
    expect(r.stderr).toMatch(/TZ was "America\/New_York"/);
  });

  it('pinUtc reports what was there and sets UTC', async () => {
    const { pinUtc } = await import('./utc-clock');
    const env: NodeJS.ProcessEnv = { TZ: 'Asia/Tokyo' };
    expect(pinUtc(env)).toEqual({ was: 'Asia/Tokyo' });
    expect(env.TZ).toBe('UTC');
    const unset: NodeJS.ProcessEnv = {};
    expect(pinUtc(unset)).toEqual({ was: undefined });
    expect(unset.TZ).toBe('UTC');
  });

  it('main.ts and worker.ts load it before anything else (bar comments and reflect-metadata)', () => {
    for (const f of ['main.ts', 'worker.ts']) {
      const imports = readFileSync(join(__dirname, '..', f), 'utf8').split('\n').filter((l) => /^import\s/.test(l));
      expect(imports[0], f).toMatch(/^import '\.\/common\/utc-clock';/);
    }
  });
});
