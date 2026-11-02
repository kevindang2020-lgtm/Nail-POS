// no-orphaned-controllers.vitest.spec.ts — every controller must actually be MOUNTED.
//
// This is the single most-repeated bug class found in this codebase. Three separate times, code was fully built,
// carefully written, and (in two cases) well tested — and then registered in no module, so it silently did
// nothing at all:
//
//   • `AiOcrReceiptController` — 13 permission-gated endpoints, a service, a pipeline, 18 passing specs and a
//     17-table migration. Never in a module. Its routes never loaded. The feature was dead.
//   • `WebAuthnService` (Face ID) — full ceremony logic, 6 security tests, its tables in place. Never in a
//     module. No route. Unreachable.
//   • …and the same shape keeps appearing elsewhere: a `login_attempts` table a dashboard READ but nobody wrote;
//     a revocation column nobody checked.
//
// The unit tests pass in every one of these cases, because unit tests exercise the piece, not whether the piece
// is plugged in. This asserts the plug.
import { codeRoots } from '../../test-support/code-roots';
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== 'node_modules') walk(p, out); }
    else if (/\.ts$/.test(e) && !/\.(spec|test)\.ts$/.test(e)) out.push(p);
  }
  return out;
}

const FILES = codeRoots().flatMap((r) => walk(r));
const SOURCES = new Map(FILES.map((f) => [f, readFileSync(f, 'utf8')]));

/** Every class decorated with @Controller. */
function controllerClasses(): { cls: string; file: string }[] {
  const out: { cls: string; file: string }[] = [];
  for (const [file, src] of SOURCES) {
    if (!src.includes('@Controller(')) continue;
    for (const m of src.matchAll(/@Controller\([^)]*\)\s*(?:export\s+)?class\s+([A-Za-z0-9_]+)/g)) {
      out.push({ cls: m[1], file });
    }
    // decorator and class may be separated by newlines/other decorators
    for (const m of src.matchAll(/export class ([A-Za-z0-9_]*Controller)\b/g)) {
      if (!out.some((o) => o.cls === m[1])) out.push({ cls: m[1], file });
    }
  }
  return out;
}

/** Everything listed inside any `controllers: [ ... ]` array, anywhere. */
function mountedControllers(): Set<string> {
  const mounted = new Set<string>();
  for (const src of SOURCES.values()) {
    for (const m of src.matchAll(/controllers\s*:\s*\[([^\]]*)\]/g)) {
      for (const name of m[1].split(',')) {
        const n = name.trim();
        if (n) mounted.add(n);
      }
    }
  }
  return mounted;
}

describe('no orphaned controllers (built, tested, and never plugged in)', () => {
  const controllers = controllerClasses();
  const mounted = mountedControllers();

  it('found the controllers and the module registrations', () => {
    expect(controllers.length).toBeGreaterThan(50);
    expect(mounted.size).toBeGreaterThan(50);
  });

  it('EVERY @Controller is declared in some module\'s `controllers: [...]`', () => {
    const orphans = controllers
      .filter((c) => !mounted.has(c.cls))
      .map((c) => `${c.cls}  (${c.file.replace(SRC, 'src')})`);

    expect(
      orphans,
      'These controllers are declared but registered in NO module, so their routes never load and the feature ' +
      'is silently dead — while every unit test for it still passes.\n' +
      'This has already happened three times in this codebase (the OCR receipt controller, WebAuthn/Face ID).\n' +
      'Add the controller to a @Module({ controllers: [...] }) and import that module into AppModule.\n\n' +
      orphans.join('\n'),
    ).toEqual([]);
  });
});

describe('every module that owns controllers is reachable from AppModule', () => {
  // A module can declare controllers and still be dead if AppModule never imports it.
  const appModule = SOURCES.get(join(SRC, 'app.module.ts')) || '';

  /** Module classes that declare at least one controller. */
  function modulesWithControllers(): { cls: string; file: string }[] {
    const out: { cls: string; file: string }[] = [];
    for (const [file, src] of SOURCES) {
      if (!/controllers\s*:\s*\[[^\]]*[A-Za-z][^\]]*\]/.test(src)) continue;   // has a non-empty controllers array
      for (const m of src.matchAll(/export class ([A-Za-z0-9_]*Module)\b/g)) out.push({ cls: m[1], file });
    }
    return out;
  }

  it('AppModule imports every module that owns controllers', () => {
    const missing = modulesWithControllers()
      .filter((m) => m.cls !== 'AppModule')
      // reachable if AppModule names it, or another module names it (transitively wired via a feature module)
      .filter((m) => {
        if (new RegExp(`\\b${m.cls}\\b`).test(appModule)) return false;
        for (const [file, src] of SOURCES) {
          if (file === m.file) continue;
          if (/imports\s*:\s*\[[^\]]*\]/.test(src) && new RegExp(`imports\\s*:\\s*\\[[^\\]]*\\b${m.cls}\\b`).test(src)) return false;
        }
        return true;
      })
      .map((m) => `${m.cls}  (${m.file.replace(SRC, 'src')})`);

    expect(
      missing,
      'These modules declare controllers but are imported by NOTHING — so their routes never mount.\n' +
      missing.join('\n'),
    ).toEqual([]);
  });
});
