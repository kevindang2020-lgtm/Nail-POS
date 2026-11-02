// wave 4 UI sweep: the kiosk page links /brand/brand-tokens.css, its icons and manifest, but `npm run build` copied
// index.html ONLY — the deployed kiosk got a JSON 404 for its stylesheet ("Refused to apply style … MIME type
// application/json") and no icons / manifest / _headers. Every /brand/ asset the page references must ship in dist.
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const APP = fileURLToPath(new URL('..', import.meta.url));
describe('kiosk build output', () => {
  it('ships every /brand/ asset index.html references, and the _headers file', () => {
    execSync('npm run -s build', { cwd: APP, stdio: 'pipe' });
    const html = readFileSync(APP + 'index.html', 'utf8');
    const refs = [...html.matchAll(/(?:href|src)="(\/brand\/[^"]+)"/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(3);
    for (const r of refs) expect(existsSync(APP + 'dist' + r), r).toBe(true);
    expect(existsSync(APP + 'dist/_headers')).toBe(true);
  });
});
