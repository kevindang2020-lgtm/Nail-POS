#!/usr/bin/env python3
"""extract-module.py — Constitution 13 Phase 6 (§209, §219): move one API domain directory into modules/<name>.

  extract-module.py <module-name> <api-src-dir> [<api-src-dir> ...] [--apply]

  One directory keeps today's flat layout (modules/<name>/src/<file>). SEVERAL directories become ONE spec module
  (§ the modules/ tree names ~21 domains, each today spread over several API directories): each keeps its own
  sub-folder (modules/<name>/src/<dir>/<file>), so relative imports BETWEEN the grouped directories keep working
  unchanged, and imports from any of them to anything outside the group are refused (§105).

  --allow-self (with --into): an added file imports the module by its own package name — rewrite each such import
  into relative imports of the exact files that export the names (resolved through the module's index.ts).
  --grouped: sub-folder layout even for ONE directory (a spec domain that will gather more with --into later).
  --into: add the directories to an EXISTING sub-foldered module (modules/<name>/src/<dir>/...). The public entry
  gains the new directories' exports, package.json/tsconfig merge the new dependencies, importers are rewired; the
  API wiring already exists. Refused for a flat (single-directory) module, and refused if an added directory already
  imports '@aipowersalon/<name>' (it would become a self-import through the package name).

  1. refuses unless the directory imports nothing else from apps/api/src or apps/api/test-support (§105)
  2. git mv every file into modules/<name>/src/ (history kept; spec files keep their names)
  3. writes src/index.ts — the ONE public entry point (§97): the Nest module class(es) plus exactly the symbols the
     rest of the API imports from this directory today (derived, not guessed), plus the DTO file's exports
  4. package.json (deps = the externals the files actually import), tsconfig (paths → package dist), vitest config
  5. rewrites every API importer of '<...>/<dir>/<file>' to '@aipowersalon/<name>' (merging duplicate import lines)
  6. wires the API: tsconfig paths and dependency (vitest aliases and the module build order are derived)
Without --apply it only reports.
"""
import os, re, sys, json, subprocess, collections
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
API = os.path.join(ROOT, 'apps/api/src'); TS = os.path.join(ROOT, 'apps/api/test-support')
pos = [a for a in sys.argv[1:] if not a.startswith('--')]
name, dirs = pos[0], pos[1:]; apply = '--apply' in sys.argv
SRCS = [os.path.join(API, x) for x in dirs]; DEST = os.path.join(ROOT, 'modules', name)
# layout root: flat for one directory, <dir>/ sub-folders for several — or for ONE with --grouped, when the module is a
# spec domain that will gather more directories later (--into refuses a flat module)
BASE = SRCS[0] if len(SRCS) == 1 and '--grouped' not in sys.argv else API
d = ' + '.join(dirs)
inside = lambda t: any(t.startswith(S + os.sep) for S in SRCS)
IMP = re.compile(r"""(import\s+(type\s+)?\{([^}]*)\}\s+from\s+|import\s+[^'"]*?from\s+|export\s+[^'"]*?from\s+|import\()(['"])([^'"]+)\4""")
files = sorted(os.path.join(dp, f) for S in SRCS for dp, _, fn in os.walk(S) for f in fn if f.endswith('.ts'))
full_ours = set()   # every @aipowersalon specifier INCLUDING subpaths (./guards, ./nest, /tenant) — for tsconfig paths
problems, externals, test_ext = [], set(), set()
BUILTINS = set(__import__('sys').stdlib_module_names) & {'crypto','fs','path','os','util','events','stream','url','http','https','zlib','child_process','buffer','assert','net','tls','dns','timers','querystring'} | {'crypto','fs','path','os','util','events','stream','url','http','https','zlib','child_process','buffer','assert','net','tls','dns','timers','querystring','module','worker_threads','perf_hooks','async_hooks','readline'}
for f in files:
    for m in IMP.finditer(open(f, encoding='utf-8').read()):
        s = m.group(5)
        if s.startswith('.'):
            t = os.path.normpath(os.path.join(os.path.dirname(f), s))
            if not inside(t): problems.append(f"{os.path.relpath(f, API)} → {s}")
        elif not s.startswith('node:') and s.split('/')[0] not in BUILTINS:
            if s.startswith('@aipowersalon/') and not re.search(r'\.(test|spec)\.ts$', f): full_ours.add(s)
            if not re.match(r'^(@[a-z0-9-~][a-z0-9-._~]*/)?[a-z0-9-~][a-z0-9-._~]*(/|$)', s): continue   # a regex literal quoted in a guard is not a package (one became devDependency '\.\' and broke npm install)
            (test_ext if re.search(r'\.(test|spec)\.ts$', f) else externals).add(s if s.startswith('@') and s.count('/') == 1 else ('/'.join(s.split('/')[:2]) if s.startswith('@') else s.split('/')[0]))
# inbound: who imports this dir, and which names
inbound = collections.defaultdict(set); inbound_files = set()
for dp, _, fn in os.walk(API):
    if inside(dp + os.sep): continue
    for f in fn:
        if not f.endswith('.ts'): continue
        p = os.path.join(dp, f); s = open(p, encoding='utf-8').read()
        for m in IMP.finditer(s):
            spec = m.group(5)
            if not spec.startswith('.'): continue
            t = os.path.normpath(os.path.join(dp, spec))
            if inside(t):
                inbound_files.add(p)
                dyn = re.search(r"\{([^{}]*)\}\s*=\s*await import\(['\"]" + re.escape(spec) + r"['\"]\)", s)   # [^{}]: a preceding arrow-function body brace once swallowed "const {" into a name
                if dyn:
                    for x in dyn.group(1).split(','):
                        x = x.strip()
                        if x: inbound[os.path.relpath(t, BASE)].add(x.split(':')[0].strip())
                if m.group(3) is not None:
                    for x in m.group(3).split(','):
                        x = re.sub(r'^\s*type\s+', '', x).strip()
                        if x: inbound[os.path.relpath(t, BASE)].add(x.split(' as ')[0].strip())
nest = []
for f in files:
    for m in re.finditer(r'@Module\([\s\S]*?\)\s*export class (\w+)', open(f, encoding='utf-8').read()): nest.append((os.path.relpath(f, BASE)[:-3], m.group(1)))
dto = [os.path.relpath(f, BASE)[:-3] for f in files if f.endswith('.dto.ts')]
print(f"{d} → modules/{name}: {len(files)} files · Nest modules {[n for _, n in nest]} · inbound from {len(inbound_files)} files: {dict((k, sorted(v)) for k, v in inbound.items())}")
print("externals:", sorted(externals), "| test-only:", sorted(test_ext - externals))
# A test that finds migrations relative to its own location ('../../db/migrations' / process.cwd()) resolves nowhere
# from a module: beforeAll throws and vitest reports the whole file SKIPPED (twice now: gift-card clearing, sms-packages).
for f in files:
    if re.search(r"(?:__dirname|process\.cwd\(\))[^\n]*db/migrations|'(?:\.\./)+db/migrations'", open(f, encoding='utf-8').read()):
        problems.append(f"{os.path.relpath(f, API)} locates db/migrations by relative path — use MIGRATIONS_DIR from @aipowersalon/database")
INTO = '--into' in sys.argv
if INTO:
    if not os.path.isdir(DEST): print(f"REFUSED — --into: modules/{name} does not exist"); sys.exit(1)
    if not any(os.path.isdir(os.path.join(DEST, 'src', x)) for x in os.listdir(os.path.join(DEST, 'src'))):
        print(f"REFUSED — --into: modules/{name} is flat (single-directory layout); sub-folder it first"); sys.exit(1)
    BASE = API
    selfimp = [os.path.relpath(f, API) for f in files if re.search(r"from ['\"]@aipowersalon/" + re.escape(name) + r"['\"]", open(f, encoding='utf-8').read())]
    if selfimp and '--allow-self' in sys.argv: print('self-imports to rewrite after the move:', selfimp)
    if selfimp and '--allow-self' not in sys.argv: problems.append(f"imports @aipowersalon/{name} (would self-import): {selfimp[:4]}")
    nest = [(os.path.relpath(f, API)[:-3], m.group(1)) for f in files for m in re.finditer(r'@Module\([\s\S]*?\)\s*export class (\w+)', open(f, encoding='utf-8').read())]
    dto = [os.path.relpath(f, API)[:-3] for f in files if f.endswith('.dto.ts')]
    # inbound keys were computed against the OLD base (flat, for one directory) — re-key them against the API so the
    # public entry points at src/<dir>/<file> (a single-directory --into exported './notifications.module' first time)
    inbound = {(os.path.relpath(os.path.join(SRCS[0], k), API) if len(SRCS) == 1 else k): v for k, v in inbound.items()}
if problems: print("REFUSED — imports outside the directory (§105):", problems[:8]); sys.exit(1)
if not apply: sys.exit(0)

# 2) move
os.makedirs(os.path.join(DEST, 'src'), exist_ok=True)
for f in files:
    rel = os.path.relpath(f, BASE); tgt = os.path.join(DEST, 'src', rel); os.makedirs(os.path.dirname(tgt), exist_ok=True)
    subprocess.run(['git', 'mv', f, tgt], check=True, cwd=ROOT)
for S in SRCS:
    try: os.removedirs(S)
    except OSError: pass
# 3) public entry
lines = [f"// modules/{name} — the {name} domain (Constitution 13 Phase 6): the ONE public entry point (§97). The API composes the Nest",
         "// module and imports ONLY from here; every other file in this module is internal (§98–99).", ""]
for rel, cls in nest: lines.append(f"export {{ {cls} }} from './{rel}';")
# DTO files are re-exported wholesale — unless two of them export the same name (serving.dto and service-done.dto both
# define ClearDelayRequest …): then `export *` is ambiguous and tsc refuses the module. Colliding files export only the
# names the API actually imports from them (handled with the other inbound names below).
def _exported_names(path):
    body = open(path, encoding='utf-8').read()
    names = set(re.findall(r'^export (?:declare )?(?:const|function|class|interface|type|enum) (\w+)', body, re.M))
    for m in re.finditer(r'^export (?:type )?\{([^}]*)\}', body, re.M):   # `export type { A, B } from '...'` re-exports collide too
        names |= {re.sub(r'^\s*type\s+', '', n).strip().split(' as ')[-1].strip() for n in m.group(1).split(',') if n.strip()}
    return names
_dto_names = {r: _exported_names(os.path.join(DEST, 'src', r + '.ts') if os.path.exists(os.path.join(DEST, 'src', r + '.ts')) else os.path.join(BASE, r + '.ts')) for r in dto}
_colliding = {r for r in dto for o in dto if o != r and _dto_names[r] & _dto_names[o]}
# --into: a DTO already re-exported wholesale by the module's entry counts too — invoices.dto and the existing
# hardware-payment.dto both export InvoiceStatus, and the payments entry stopped compiling.
if INTO and os.path.exists(os.path.join(DEST, 'src', 'index.ts')):
    for _m in re.finditer(r"^export \* from '\./([^']+)';", open(os.path.join(DEST, 'src', 'index.ts'), encoding='utf-8').read(), re.M):
        _f = os.path.join(DEST, 'src', _m.group(1) + '.ts')
        if not os.path.exists(_f): continue
        _have = _exported_names(_f)
        _colliding |= {r for r in dto if _dto_names[r] & _have}
if _colliding: print('DTO name collisions — explicit exports for:', sorted(_colliding))
for rel in dto:
    if rel not in _colliding: lines.append(f"export * from './{rel}';")
nest_rels = {rel for rel, _ in nest}
for rel, names in sorted(inbound.items()):
    if rel in dto and rel not in _colliding: continue   # already exported above (export *)
    if rel in nest_rels:
        # the Nest module is exported above — but a file that DEFINES the module can also export what the API imports
        # (booking-conversion.emitter.ts holds both BookingConversionModule and BookingConversionEmitter; the second
        # was silently left out of the public entry the first time)
        names = names - {cls for r2, cls in nest if r2 == rel}
        if not names: continue
    lines.append(f"export {{ {', '.join(sorted(names))} }} from './{rel}';   // used by the API today")
if INTO:
    idx = os.path.join(DEST, 'src/index.ts'); cur = open(idx, encoding='utf-8').read()
    add = [l for l in lines[3:] if l and l not in cur]
    open(idx, 'a', encoding='utf-8').write(f"// joined by --into ({', '.join(dirs)}):\n" + '\n'.join(add) + '\n')
else:
    open(os.path.join(DEST, 'src/index.ts'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
# 4) package metadata
api_pkg = json.load(open(os.path.join(ROOT, 'apps/api/package.json')))
alldeps = {**api_pkg.get('dependencies', {}), **api_pkg.get('devDependencies', {})}
deps = {e: alldeps.get(e, '*') for e in sorted(externals) if e not in ('vitest',)}
pkg = {"name": f"@aipowersalon/{name}", "version": "0.1.0", "private": True,
       "description": f"The {name} domain module (Constitution 13 Phase 6). Depends on packages only; consumed compiled by apps/api.",
       "main": "dist/index.js", "types": "dist/index.d.ts", "exports": {".": {"types": "./dist/index.d.ts", "default": "./dist/index.js"}},
       "files": ["dist"], "scripts": {"build": "tsc -p tsconfig.json", "test": "vitest run", "typecheck": "tsc --noEmit -p tsconfig.json"}, "dependencies": deps,
       # the module compiles against the SAME Node typings as the API it runs inside (apps/api pins @types/node; the
       # hoisted root copy is a newer major, and push-providers.ts failed to type-check against it)
       "devDependencies": {**{e: alldeps.get(e, "*") for e in sorted(test_ext - externals) if e != "vitest"}, **({"@types/node": alldeps["@types/node"]} if "@types/node" in alldeps else {})}}
if INTO:
    cur = json.load(open(os.path.join(DEST, 'package.json')))
    cur.setdefault('dependencies', {}).update({k: v for k, v in pkg['dependencies'].items() if k != f'@aipowersalon/{name}'})
    cur.setdefault('devDependencies', {}).update(pkg['devDependencies']); pkg = cur
json.dump(pkg, open(os.path.join(DEST, 'package.json'), 'w'), indent=2); open(os.path.join(DEST, 'package.json'), 'a').write('\n')
ours = sorted(e for e in externals if e.startswith('@aipowersalon/'))
def pkgdir(e):
    n = e.split('/')[1]
    return f"../../{'modules' if os.path.isdir(os.path.join(ROOT, 'modules', n)) else 'packages'}/{n}"
tc = {"compilerOptions": {"target": "ES2021", "module": "commonjs", "moduleResolution": "node", "strict": True, "esModuleInterop": True,
      "experimentalDecorators": True, "emitDecoratorMetadata": True, "declaration": True, "rootDir": "src", "outDir": "dist",
      "skipLibCheck": True, "types": ["node"], "paths": {e: [f"{pkgdir(e)}/dist/index.d.ts" if '/' not in e[len('@aipowersalon/'):] else f"{pkgdir(e.rsplit('/',1)[0])}/dist/{e.rsplit('/',1)[1]}/index.d.ts"] for e in sorted(set(ours) | full_ours)}},
      "include": ["src/**/*.ts"], "exclude": ["src/**/*.test.ts", "src/**/*.spec.ts"]}
if INTO:
    cur = json.load(open(os.path.join(DEST, 'tsconfig.json')))
    cur['compilerOptions'].setdefault('paths', {}).update(tc['compilerOptions']['paths']); tc = cur
# Every api-contracts subpath, not only the ones this module names: a DEPENDENCY's .d.ts can name another subpath, and an
# unmapped one resolves to `any` SILENTLY (modules/ai lost booking's AvailabilityResult that way — tsc then only
# complained about implicit anys downstream).
tc['compilerOptions'].setdefault('paths', {})['@aipowersalon/api-contracts/*'] = ['../../packages/api-contracts/dist/*/index.d.ts']
json.dump(tc, open(os.path.join(DEST, 'tsconfig.json'), 'w'), indent=2)
# aliases are DERIVED from the module's package.json + each package's exports map (root and subpath entries, anchored)
open(os.path.join(DEST, 'vitest.config.ts'), 'w').write("import { defineConfig } from 'vitest/config';\nimport { workspaceAliases } from '../../tooling/vitest/workspace-aliases.mjs';\nexport default defineConfig({\n  resolve: { alias: workspaceAliases(import.meta.url) },\n  test: { environment: 'node', include: ['src/**/*.test.ts', 'src/**/*.vitest.spec.ts'], passWithNoTests: true, hookTimeout: 60000 },\n});\n")
# --allow-self: rewrite each self-import ('@aipowersalon/<name>') in the moved files into relative imports of the
# exact files that export each name, resolved through the module's own public entry (index.ts).
if INTO and '--allow-self' in sys.argv:
    idx_src = open(os.path.join(DEST, 'src/index.ts'), encoding='utf-8').read()
    where = {}
    for m in re.finditer(r"export \{([^}]*)\} from '\./([^']+)'", idx_src):
        for n in m.group(1).split(','):
            n = re.sub(r'^\s*type\s+', '', n).strip().split(' as ')[-1].strip()
            if n: where[n] = m.group(2)
    for m in re.finditer(r"export \* from '\./([^']+)'", idx_src):
        body = open(os.path.join(DEST, 'src', m.group(1) + '.ts'), encoding='utf-8').read()
        for n in re.findall(r'^export (?:declare )?(?:const|function|class|interface|type|enum|async function) (\w+)', body, re.M): where.setdefault(n, m.group(1))
    for f in files:
        tgt = os.path.join(DEST, 'src', os.path.relpath(f, BASE)); s2 = open(tgt, encoding='utf-8').read()
        def fix_self(m):
            ty = m.group(1) or ''; groups = collections.OrderedDict()
            for n in [x.strip() for x in m.group(2).split(',') if x.strip()]:
                base_n = re.sub(r'^type\s+', '', n).split(' as ')[0].strip()
                if base_n not in where: raise SystemExit(f"--allow-self: cannot resolve {base_n} in {tgt}")
                groups.setdefault(where[base_n], []).append(n)
            out = []
            for rel, names in groups.items():
                r = os.path.relpath(os.path.join(DEST, 'src', rel), os.path.dirname(tgt))
                out.append(f"import {ty}{{ {', '.join(names)} }} from '{r if r.startswith('.') else './' + r}';")
            return '\n'.join(out)
        s3 = re.sub(r"import (type )?\{([^}]*)\} from '@aipowersalon/" + re.escape(name) + r"';", fix_self, s2)
        if s3 != s2: open(tgt, 'w', encoding='utf-8').write(s3); print('self-import rewritten:', os.path.relpath(tgt, ROOT))
    pj = os.path.join(DEST, 'package.json'); dd = json.load(open(pj))
    for k in ('dependencies', 'devDependencies'): dd.get(k, {}).pop(f'@aipowersalon/{name}', None)
    json.dump(dd, open(pj, 'w'), indent=2); open(pj, 'a').write('\n')
# 5) rewrite API importers
for p in sorted(inbound_files):
    s = open(p, encoding='utf-8').read(); dp = os.path.dirname(p)
    def repl(m):
        t = os.path.normpath(os.path.join(dp, m.group(5)))
        return m.group(0).replace(m.group(4) + m.group(5) + m.group(4), f"'@aipowersalon/{name}'") if inside(t) else m.group(0)
    s = IMP.sub(repl, s)
    blocks = re.findall(r"^import (type )?\{([^}]*)\} from '@aipowersalon/" + re.escape(name) + r"';\n", s, re.M)
    if len(blocks) > 1:
        names = []
        for ty, body in blocks:
            for x in body.split(','):
                x = x.strip()
                if x: x = ('type ' + x) if ty and not x.startswith('type ') else x
                if x and x not in names: names.append(x)
        s = re.sub(r"^import (type )?\{[^}]*\} from '@aipowersalon/" + re.escape(name) + r"';\n", '', s, flags=re.M)
        first = re.search(r'^import .*$', s, re.M); stmt = f"import {{ {', '.join(names)} }} from '@aipowersalon/{name}';\n"
        s = s[:first.start()] + stmt + s[first.start():] if first else stmt + s
    open(p, 'w', encoding='utf-8').write(s)
# 6) wire the API + root
t = os.path.join(ROOT, 'apps/api/tsconfig.json'); s = open(t, encoding='utf-8').read()
d = json.loads(s); d['compilerOptions'].setdefault('paths', {})[f'@aipowersalon/{name}'] = [f'../../../modules/{name}/dist/index.d.ts']
open(t, 'w', encoding='utf-8').write(json.dumps(d, indent=2) + '\n')
# the API's vitest aliases are derived from apps/api/package.json (tooling/vitest/workspace-aliases.mjs) — adding the
# dependency below is what makes the module resolvable in tests; nothing to edit in vitest.config.ts
pj = os.path.join(ROOT, 'apps/api/package.json'); a = json.load(open(pj)); a['dependencies'][f'@aipowersalon/{name}'] = '*'
json.dump(a, open(pj, 'w'), indent=2); open(pj, 'a').write('\n')
rp = os.path.join(ROOT, 'package.json'); r = json.load(open(rp))
# build:modules is `node tooling/modules/build-modules.mjs`, which derives the dependency order from every
# modules/*/package.json — nothing to add per module (a fixed list broke once a module imported another).
json.dump(r, open(rp, 'w'), indent=2); open(rp, 'a').write('\n')
print("applied")
