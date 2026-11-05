// code-roots.ts — Constitution 13: the API's code surface is apps/api/src PLUS every domain module's src PLUS the
// workspace packages the API depends on (the code it runs, wherever it lives). A guard that walks only `src` narrows
// silently each time something moves out (the secrets inventory, the Math.random review list and the tenant-isolation
// baseline all did when the first modules left; the H9 list lost realtime-core when it became a package). Every
// code-walking guard takes its roots from here.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
export const API_SRC = join(process.cwd(), 'src');
const MODULES = join(process.cwd(), '..', '..', 'modules');
const PACKAGES = join(process.cwd(), '..', '..', 'packages');
export const moduleRoots = (): string[] => existsSync(MODULES) ? readdirSync(MODULES).map((m) => join(MODULES, m, 'src')).filter((d) => existsSync(d)) : [];
/** The workspace packages apps/api depends on (read from its package.json), minus the domain modules (walked above). */
export const packageRoots = (): string[] => {
  const deps = Object.keys(JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).dependencies ?? {});
  return deps.filter((d) => d.startsWith('@aipowersalon/')).map((d) => join(PACKAGES, d.slice('@aipowersalon/'.length), 'src')).filter((d) => existsSync(d));
};
export const codeRoots = (): string[] => [API_SRC, ...moduleRoots(), ...packageRoots()];
/** A stable key for a file: API files relative to src; module files as <module>/<file> (the directory name became the
 *  module name); package files as packages/<package>/<file>. */
export const codeKey = (f: string): string => {
  if (f.startsWith(API_SRC + '/')) return f.replace(API_SRC + '/', '');
  const m = /\/modules\/([^/]+)\/src\/(.+)$/.exec(f);
  // grouped module (modules/<m>/src/<dir>/<file>) → <dir>/<file>, the key reviewed lists were written against;
  // flat module → <module>/<file> (the directory became the module name)
  if (m) return m[2].includes('/') ? m[2] : `${m[1]}/${m[2]}`;
  return f.replace(/^.*\/packages\/([^/]+)\/src\//, 'packages/$1/');
};

/** The source path a guard means by an apps/api-relative 'src/<dir>/<file>' (or a bare '<dir>/<file>'): the API's copy
 *  if it is still there, otherwise the module that owns <dir> (grouped modules keep <dir> as a sub-folder). Guards that
 *  read another file's source by path kept going blind as directories moved (Constitution 13); this is the one
 *  resolver they share. Throws with the path it looked for when neither exists. */
export const sourcePath = (rel: string): string => {
  const direct = join(process.cwd(), rel);   // an explicit path (e.g. '../../modules/<m>/src/...') is taken as written
  if (rel.startsWith('..') && existsSync(direct)) return direct;
  const r = rel.replace(/^src\//, '');
  const api = join(API_SRC, r);
  if (existsSync(api)) return api;
  for (const root of moduleRoots()) { const p = join(root, r); if (existsSync(p)) return p; }
  throw new Error(`sourcePath: ${rel} exists in neither apps/api/src nor any module`);
};
