// route-collision.vitest.spec.ts — permanent guard against route SHADOWING.
//
// Why this exists: `GET /owner/context` was declared by BOTH OwnerController and OwnerPortfolioController.
// Nest registers controllers in module-import order, so OwnerPortfolioModule (imported first in app.module)
// won the path and OwnerController.context() never ran — owner-web's branch selector silently received the
// portfolio payload, `allowedBranches` came back undefined, and the branch list was empty in production.
//
// Nothing caught it: DI_GRAPH_OK passes (both modules load fine), tsc passes (both are valid), and every
// frontend test mocked the API client, so the URL itself was never exercised. A duplicate route is not a
// type error and not a DI error — it is a silent behavioural one. Hence this test.
//
// Shared PREFIXES are fine and common in this codebase (10 controllers share 'customer'); only an exact
// METHOD + full-path duplicate actually shadows.
import { codeRoots } from '../../test-support/code-roots';
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(process.cwd(), 'src');
const METHODS = ['Get', 'Post', 'Put', 'Patch', 'Delete', 'All', 'Head', 'Options'];

/** Blank out comments WITHOUT a regex. A line comment may legitimately contain `/*` (e.g. a doc header
 *  mentioning `/tenant/ai/receptionist/*`); a naive block-comment regex would match that and swallow real
 *  code up to the next close-comment, hiding whole controllers. */
function stripComments(src: string): string {
  let out = '';
  for (let i = 0; i < src.length; ) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && d === '*') {
      out += '  '; i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      if (i < src.length) { out += '  '; i += 2; }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += c; i++;
      while (i < src.length) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        out += src[i];
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'node_modules' && name !== 'dist') walk(p, acc); }
    else if (p.endsWith('.controller.ts') && !/\.(spec|test)\.ts$/.test(p)) acc.push(p);
  }
  return acc;
}

type Route = { method: string; path: string; controller: string; file: string };

function collectRoutes(): Route[] {
  const routes: Route[] = [];
  for (const file of codeRoots().flatMap((r) => walk(r))) {
    const text = stripComments(readFileSync(file, 'utf8'));
    // @Controller('prefix') — tolerate any decorators between it and `class` (e.g. @UseGuards)
    const ctlRe = /@Controller\s*\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)\s*(?:@[A-Za-z0-9_]+\s*(?:\([^)]*\))?\s*)*(?:export\s+)?class\s+([A-Za-z0-9_]+)/g;
    const marks: { prefix: string; cls: string; at: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = ctlRe.exec(text))) marks.push({ prefix: m[1] || '', cls: m[2], at: m.index });

    for (let i = 0; i < marks.length; i++) {
      const block = text.slice(marks[i].at, i + 1 < marks.length ? marks[i + 1].at : text.length);
      for (const verb of METHODS) {
        const re = new RegExp(`@${verb}\\s*\\(\\s*(?:['"\`]([^'"\`]*)['"\`])?\\s*\\)`, 'g');
        let mm: RegExpExecArray | null;
        while ((mm = re.exec(block))) {
          const full = ('/' + [marks[i].prefix, mm[1] || ''].filter(Boolean).join('/')).replace(/\/+/g, '/');
          routes.push({
            method: verb.toUpperCase(),
            // :id and :ticketId occupy the same slot — normalise so they collide-check identically
            path: full.replace(/:[A-Za-z0-9_]+/g, ':param'),
            controller: marks[i].cls,
            file: file.replace(SRC + '/', ''),
          });
        }
      }
    }
  }
  return routes;
}

describe('HTTP route table', () => {
  const routes = collectRoutes();

  it('parses a plausible route table (guards against the scanner silently finding nothing)', () => {
    expect(routes.length).toBeGreaterThan(1500);
    expect(new Set(routes.map((r) => r.controller)).size).toBeGreaterThan(200);
  });

  it('no two controllers register the same METHOD + path (no shadowed routes)', () => {
    const byKey = new Map<string, Route[]>();
    for (const r of routes) {
      const k = `${r.method} ${r.path}`;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)!.push(r);
    }
    const collisions = [...byKey.entries()]
      .filter(([, v]) => v.length > 1)
      .map(([k, v]) => `${k}  ←  ${v.map((r) => `${r.controller} [${r.file}]`).join('  vs  ')}`);
    expect(collisions).toEqual([]);
  });

  it('/owner/context belongs to owner-portfolio alone; the owner branch context is a distinct path', () => {
    const ctx = routes.filter((r) => r.method === 'GET' && r.path === '/owner/context');
    expect(ctx.map((r) => r.controller)).toEqual(['OwnerPortfolioController']);
    expect(routes.some((r) => r.method === 'GET' && r.path === '/owner/branch-context' && r.controller === 'OwnerController')).toBe(true);
  });
});
