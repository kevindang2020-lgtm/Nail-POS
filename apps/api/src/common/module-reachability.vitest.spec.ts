// module-reachability.vitest.spec — every Nest module in src/ is reachable from AppModule.
//
// WHY THIS EXISTS. Registering ObservabilityModule, I inserted `ObservabilityModule,   // comment` after
// `imports: [` without a newline. The rest of that line — `CustomerPhoneModule,` — ended up after the `//` and was
// COMMENTED OUT. Phone-number changes and the daily phone sync silently stopped being part of the app, and tsc,
// check:di, 507 tests and 17 gates all passed: no test boots the whole app, and nothing checked registration.
//
// This walks the import graph from AppModule exactly as the compiler would read it — comments stripped first — and
// fails if any module class is unreachable. The baseline is zero unreachable modules, so there is no exception list.
import { codeRoots } from '../../test-support/code-roots';
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(process.cwd(), 'src');
const walk = (d: string, o: string[] = []): string[] => {
  for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p, o); else if (p.endsWith('.module.ts')) o.push(p); }
  return o;
};
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const modules = new Map<string, { file: string; deps: Set<string> }>();
for (const f of codeRoots().flatMap((r) => walk(r))) {
  const s = strip(readFileSync(f, 'utf8'));
  for (const m of s.matchAll(/@Module\(\{([\s\S]*?)\}\)\s*export class (\w+)/g)) {
    const im = /imports:\s*\[([\s\S]*?)\]/.exec(m[1]);
    modules.set(m[2], { file: relative(SRC, f), deps: new Set(im ? im[1].match(/\b[A-Z]\w*Module\b/g) ?? [] : []) });
  }
}

describe('every module is reachable from AppModule', () => {
  it('finds the module graph at all — a guard that parses nothing guards nothing', () => {
    expect(modules.has('AppModule')).toBe(true);
    expect(modules.size).toBeGreaterThan(150);
  });

  it('no module is unregistered', () => {
    const seen = new Set<string>(); const stack = ['AppModule'];
    while (stack.length) { const x = stack.pop()!; if (seen.has(x) || !modules.has(x)) continue; seen.add(x); stack.push(...modules.get(x)!.deps); }
    const unreachable = [...modules.keys()].filter((k) => !seen.has(k)).map((k) => `${k} (${modules.get(k)!.file})`);
    expect(unreachable, `unreachable from AppModule — imported nowhere, or commented out:\n${unreachable.join('\n')}`).toEqual([]);
  });
});
