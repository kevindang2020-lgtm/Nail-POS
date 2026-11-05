// workspace-aliases.mjs — Constitution 13 §175: a test alias resolves to a package's PUBLIC entry (src/index.ts),
// never an internal path — and it must cover the package's SUBPATH entries too (`@aipowersalon/permissions/guards`,
// `@aipowersalon/api-contracts/tenant`). A plain string alias for the root name prefix-matches the subpaths and turns
// `@aipowersalon/permissions/guards` into `.../src/index.ts/guards`, which is exactly the trap this file exists to
// close. So every alias is an anchored RegExp, and the list is DERIVED: the calling workspace's package.json says which
// @aipowersalon packages it depends on; each package's `exports` map says which subpaths exist. Nothing to keep in
// step by hand when a package or a subpath is added.
//
// Usage (vitest.config.ts of an app, a module or a package):
//   import { workspaceAliases } from '../../tooling/vitest/workspace-aliases.mjs';
//   export default defineConfig({ resolve: { alias: workspaceAliases(import.meta.url) }, ... });
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Where a workspace package lives (packages/ first, then modules/). */
function packageDir(name) {
  const short = name.slice('@aipowersalon/'.length);
  for (const base of ['packages', 'modules']) {
    const d = join(ROOT, base, short);
    if (existsSync(join(d, 'package.json'))) return d;
  }
  return null;
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * Aliases for every @aipowersalon dependency of the workspace whose vitest.config.ts calls this (found from its
 * package.json), plus their subpath exports. Tests resolve packages to SOURCE, so vitest needs no prior build.
 * @param {string} importMetaUrl  the caller's import.meta.url
 * @param {{ extra?: string[] }} [opts]  extra package names to alias (e.g. a package used only by tests)
 */
export function workspaceAliases(importMetaUrl, opts = {}) {
  const here = dirname(fileURLToPath(importMetaUrl));
  const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
  const names = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {}), ...(opts.extra ?? [])].filter((n) => n.startsWith('@aipowersalon/')));
  const out = [];
  for (const name of [...names].sort()) {
    const dir = packageDir(name);
    if (!dir) continue;
    const exportsMap = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).exports ?? {};
    const subpaths = Object.keys(exportsMap).filter((k) => k.startsWith('./')).map((k) => k.slice(2));
    for (const sub of subpaths) {
      const src = existsSync(join(dir, 'src', sub, 'index.ts')) ? join(dir, 'src', sub, 'index.ts') : join(dir, 'src', `${sub}.ts`);
      out.push({ find: new RegExp(`^${escape(name)}/${escape(sub)}$`), replacement: src });
    }
    out.push({ find: new RegExp(`^${escape(name)}$`), replacement: join(dir, 'src', 'index.ts') });
  }
  return out;
}
