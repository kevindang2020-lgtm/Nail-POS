#!/usr/bin/env python3
"""move-to-package.py — Constitution 13 Phase 5 (§219: import migration is done by a tool, not by hand).

Move one or more files out of apps/api/src into an EXISTING package and rewire every importer to the package name.

  tooling/packages/move-to-package.py <package> <apps/api/src-relative file>... [--with-tests] [--apply]

  1. refuses unless every moved file's relative imports resolve INSIDE the moved set (a package must not reach back
     into the API — §105 / §93: PLATFORM and FOUNDATION never depend on APP)
  2. `git mv` each file to packages/<package>/src/<basename>.ts (history kept); with --with-tests the sibling
     <file>.vitest.spec.ts moves too, renamed <basename>.test.ts (the package test convention)
  3. appends `export * from './<basename>'` to the package's public entry (src/index.ts)
  4. rewrites every importer under apps/api/src, apps/api/test-support and modules/*/src — a relative import that
     RESOLVES to a moved file becomes `from '@aipowersalon/<package>'`; several such lines in one file are merged
     into one import statement (`import type` names keep their `type` qualifier)
  5. adds the package to the dependencies of every domain module that now imports it
  6. reports dynamic `import('...')` strings it cannot rewrite (one of those hid from the permissions move)

Dry-run by default; nothing changes without --apply.
"""
import json, os, re, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
API_SRC = os.path.join(ROOT, 'apps', 'api', 'src')
args = [a for a in sys.argv[1:] if not a.startswith('--')]
APPLY = '--apply' in sys.argv
WITH_TESTS = '--with-tests' in sys.argv
if len(args) < 2:
    print(__doc__); sys.exit(2)
pkg, rels = args[0], args[1:]
PKG_DIR = os.path.join(ROOT, 'packages', pkg)
PKG_SRC = os.path.join(PKG_DIR, 'src')
NAME = f'@aipowersalon/{pkg}'
if not os.path.isfile(os.path.join(PKG_SRC, 'index.ts')):
    print(f'refusing: {NAME} has no src/index.ts (this tool moves into an EXISTING package)'); sys.exit(1)

def norm(rel):
    rel = rel[:-3] if rel.endswith('.ts') else rel
    return rel
moved = {norm(r) for r in rels}                       # apps/api/src-relative, no extension
for m in moved:
    if not os.path.isfile(os.path.join(API_SRC, m + '.ts')):
        print(f'refusing: apps/api/src/{m}.ts does not exist'); sys.exit(1)
basenames = {m: os.path.basename(m) for m in moved}
if len(set(basenames.values())) != len(basenames):
    print('refusing: two moved files share a basename'); sys.exit(1)

IMPORT_RE = re.compile(r"""(?P<lead>\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)(?P<q>['"])(?P<spec>\.[^'"]+)(?P=q)""")   # require(): six lazy requires of common/redis were invisible to the first version

# ── 1. the moved files must not reach back into the API ─────────────────────────────────────────────────
problems = []
for m in moved:
    src = open(os.path.join(API_SRC, m + '.ts'), encoding='utf-8').read()
    for im in IMPORT_RE.finditer(src):
        target = os.path.normpath(os.path.join(os.path.dirname(m), im.group('spec')))
        if target not in moved:
            problems.append(f'{m}.ts imports ./{im.group("spec")} -> apps/api/src/{target} (not in the moved set)')
if problems:
    print('refusing — a package must not import the API:'); print('\n'.join('  ' + p for p in problems)); sys.exit(1)

# a moved file that imports its DESTINATION package by name would import itself (and tsc refuses: its own dist would be
# an input) — found moving realtime/settings-changed into realtime-contracts
for m in moved:
    if re.search(r"from ['\"]" + re.escape(NAME) + r"['\"]", open(os.path.join(API_SRC, m + '.ts'), encoding='utf-8').read()):
        problems.append(f"{m}.ts imports {NAME} — the package it is moving into; import the sibling files relatively first")
if problems:
    print('refusing:'); print('\n'.join('  ' + p for p in problems)); sys.exit(1)

# ── 4. find importers ───────────────────────────────────────────────────────────────────────────────────
def walk(d):
    for dp, _, fn in os.walk(d):
        for f in fn:
            if f.endswith('.ts') or f.endswith('.tsx'):
                yield os.path.join(dp, f)
roots = [API_SRC, os.path.join(ROOT, 'apps', 'api', 'test-support')]
MODULES = os.path.join(ROOT, 'modules')
module_roots = [os.path.join(MODULES, d, 'src') for d in sorted(os.listdir(MODULES))] if os.path.isdir(MODULES) else []
roots += [r for r in module_roots if os.path.isdir(r)]

rewrites, dynamic, touched_modules = {}, [], set()
def resolves_to_moved(from_file, spec):
    target = os.path.normpath(os.path.join(os.path.dirname(from_file), spec))
    rel = os.path.relpath(target, API_SRC)
    return rel in moved
for r in roots:
    for f in walk(r):
        if f.startswith(PKG_SRC): continue
        if f.startswith(API_SRC):
            relf = os.path.relpath(f, API_SRC)
            if relf[:-3] in moved or (relf.endswith('.vitest.spec.ts') and relf[:-len('.vitest.spec.ts')] in moved and WITH_TESTS):
                continue   # a moved file: its imports of other moved files become siblings after the move (below)
        s = open(f, encoding='utf-8').read()
        out, hit = [], False
        pos = 0
        for im in IMPORT_RE.finditer(s):
            if not resolves_to_moved(f, im.group('spec')): continue
            if im.group('lead').strip().startswith(('import', 'require')):
                dynamic.append(f'{os.path.relpath(f, ROOT)}: {im.group(0)}'); continue
            out.append(s[pos:im.start()]); out.append(f"{im.group('lead')}'{NAME}'"); pos = im.end(); hit = True
        if not hit: continue
        out.append(s[pos:]); new = ''.join(out)
        # merge several `import {...} from '@aipowersalon/<pkg>'` lines into one
        lines = re.findall(r"^import (type )?\{([^}]*)\} from '" + re.escape(NAME) + r"';[ \t]*\n", new, re.M)
        if len(lines) > 1:
            names = []
            for ty, body in lines:
                for x in body.split(','):
                    x = x.strip()
                    if not x: continue
                    n = ('type ' if ty and not x.startswith('type ') else '') + x
                    if n not in names: names.append(n)
            new = re.sub(r"^import (type )?\{[^}]*\} from '" + re.escape(NAME) + r"';[ \t]*\n", '', new, flags=re.M)
            first = re.search(r'^import .*$', new, re.M)
            stmt = f"import {{ {', '.join(names)} }} from '{NAME}';\n"
            new = (new[:first.start()] + stmt + new[first.start():]) if first else stmt + new
        rewrites[f] = new
        for mr in module_roots:
            if f.startswith(mr): touched_modules.add(os.path.dirname(mr))

print(f'move -> {NAME}: {sorted(moved)}')
print(f'importers to rewrite: {len(rewrites)}  (in modules: {len([f for f in rewrites if f.startswith(MODULES)])})')
for d in dynamic: print('  DYNAMIC import, rewrite by hand:', d)
if not APPLY:
    print('dry run — pass --apply'); sys.exit(0)

# ── 2. git mv ───────────────────────────────────────────────────────────────────────────────────────────
def git(*a):
    subprocess.run(['git', *a], cwd=ROOT, check=True)
for m in sorted(moved):
    b = basenames[m]
    git('add', f'apps/api/src/{m}.ts')   # a file created in this session is untracked, and `git mv` refuses it (trust-proxy.ts did)
    git('mv', f'apps/api/src/{m}.ts', f'packages/{pkg}/src/{b}.ts')
    spec = os.path.join(API_SRC, m + '.vitest.spec.ts')
    if WITH_TESTS and os.path.isfile(spec):
        git('mv', f'apps/api/src/{m}.vitest.spec.ts', f'packages/{pkg}/src/{b}.test.ts')
        # the moved test's own imports of API helpers would be a reach-back; fail loudly if any remain
        t = open(os.path.join(PKG_SRC, b + '.test.ts'), encoding='utf-8').read()
        for im in IMPORT_RE.finditer(t):
            tgt = os.path.basename(os.path.normpath(im.group('spec')))
            if tgt not in basenames.values():
                print(f'WARNING: {b}.test.ts still imports {im.group("spec")} — fix by hand')
# moved files: imports of other moved files become sibling imports
for m in sorted(moved):
    for fn in (basenames[m] + '.ts', basenames[m] + '.test.ts'):
        p = os.path.join(PKG_SRC, fn)
        if not os.path.isfile(p): continue
        t = open(p, encoding='utf-8').read()
        def sib(im):
            target = os.path.normpath(os.path.join(os.path.dirname(m), im.group('spec')))
            return f"{im.group('lead')}'./{basenames[target]}'" if target in basenames else im.group(0)
        t2 = IMPORT_RE.sub(sib, t)
        if t2 != t: open(p, 'w', encoding='utf-8').write(t2)
# ── 3. public entry ─────────────────────────────────────────────────────────────────────────────────────
idx = os.path.join(PKG_SRC, 'index.ts')
s = open(idx, encoding='utf-8').read()
if not s.endswith('\n'): s += '\n'
for m in sorted(moved):
    line = f"export * from './{basenames[m]}';"
    if line not in s: s += line + f"   // moved from apps/api/src/{m}.ts (Constitution 13 §219)\n"
open(idx, 'w', encoding='utf-8').write(s)
# ── 4. rewrite importers ────────────────────────────────────────────────────────────────────────────────
for f, new in rewrites.items():
    open(f, 'w', encoding='utf-8').write(new)
# ── 5. module dependencies ──────────────────────────────────────────────────────────────────────────────
for md in sorted(touched_modules):
    pj = os.path.join(md, 'package.json'); d = json.load(open(pj, encoding='utf-8'))
    if NAME not in d.get('dependencies', {}):
        d.setdefault('dependencies', {})[NAME] = '*'
        json.dump(d, open(pj, 'w', encoding='utf-8'), indent=2); open(pj, 'a').write('\n')
        print(f'added {NAME} to {os.path.relpath(pj, ROOT)}')
# ── 6. the API's wiring (idempotent): dependency, compiled-dist tsconfig paths for the root and every subpath export,
#       and the root build:packages list. Test aliases need nothing — tooling/vitest/workspace-aliases.mjs derives them.
pj = os.path.join(ROOT, 'apps', 'api', 'package.json'); d = json.load(open(pj, encoding='utf-8'))
if NAME not in d.get('dependencies', {}):
    d.setdefault('dependencies', {})[NAME] = '*'; json.dump(d, open(pj, 'w', encoding='utf-8'), indent=2); open(pj, 'a').write('\n')
    print(f'added {NAME} to apps/api/package.json')
tc = os.path.join(ROOT, 'apps', 'api', 'tsconfig.json'); d = json.load(open(tc, encoding='utf-8'))
paths = d['compilerOptions'].setdefault('paths', {})
exports = json.load(open(os.path.join(PKG_DIR, 'package.json'), encoding='utf-8')).get('exports', {'.': {}})
for k in exports:
    key = NAME if k == '.' else f'{NAME}/{k[2:]}'
    paths.setdefault(key, [f'../../../packages/{pkg}/dist/index.d.ts' if k == '.' else f'../../../packages/{pkg}/dist/{k[2:]}/index.d.ts'])
json.dump(d, open(tc, 'w', encoding='utf-8'), indent=2); open(tc, 'a').write('\n')
rp = os.path.join(ROOT, 'package.json'); d = json.load(open(rp, encoding='utf-8'))
if f'--workspace {NAME}' not in d['scripts']['build:packages']:
    d['scripts']['build:packages'] += f' --workspace {NAME}'; json.dump(d, open(rp, 'w', encoding='utf-8'), indent=2); open(rp, 'a').write('\n')
    print(f'added {NAME} to build:packages')
print('applied')
