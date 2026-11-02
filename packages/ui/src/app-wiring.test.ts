// app-wiring.test — Constitution 11 §199: every web app starts error reporting and renders inside the boundary.
//
// Seven apps had no boundary. This keeps it that way no longer: each root must call initErrorReporting and wrap its
// tree in <AppErrorBoundary>. It also pins a mistake made while wiring them: a trailing comma from the original
// render(…) argument landed INSIDE the boundary, where JSX renders it as a literal "," on every screen — invisible to
// tsc. A new app added without the boundary fails the count check.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const APPS_DIR = join(__dirname, '../../../apps');
const EXPECTED = { 'pos-web': 'pos', 'admin-web': 'admin', 'owner-web': 'owner', 'tech-web': 'tech', 'customer-web': 'customer', 'manager-pay-web': 'manager-pay', 'customer-display': 'customer-display' } as const;
const reactApps = readdirSync(APPS_DIR).filter((d) => existsSync(join(APPS_DIR, d, 'src/main.tsx')));

describe('every React app is wired for error reporting', () => {
  it('no React app is missing from the list — a new app must be wired too', () => {
    expect(reactApps.sort()).toEqual(Object.keys(EXPECTED).sort());
  });
  for (const [dir, app] of Object.entries(EXPECTED)) {
    const src = readFileSync(join(APPS_DIR, dir, 'src/main.tsx'), 'utf8');
    it(`${dir} initialises reporting as '${app}' BEFORE rendering`, () => {
      const init = src.indexOf(`initErrorReporting('${app}')`);
      expect(init, 'initErrorReporting call').toBeGreaterThan(-1);
      expect(init, 'must run before createRoot/render').toBeLessThan(src.indexOf('.render('));
    });
    it(`${dir} renders its whole tree inside <AppErrorBoundary>`, () => {
      const r = src.slice(src.indexOf('.render('));
      expect(r.replace(/\s+/g, ' ')).toMatch(/^\.render\( <AppErrorBoundary>/);
    });
    it(`${dir} has no stray text node inside the boundary (a comma renders on every screen)`, () => {
      const inner = src.slice(src.indexOf('<AppErrorBoundary>'), src.indexOf('</AppErrorBoundary>'));
      expect(inner).not.toMatch(/>\s*,\s*$/m);
    });
  }
});
