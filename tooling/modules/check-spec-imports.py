#!/usr/bin/env python3
"""check-spec-imports.py — every RELATIVE import (from / import() / require() / vi.mock) in a test file, a dev script
or any other file tsc does not compile must resolve to a file. The API's tsc excludes
*.spec.ts, so a test importing a moved file is only found when vitest loads it — and a file that fails to LOAD
drops all of its tests from the count (constitution-9-named-tests did exactly that when the SSE controllers moved).
Exit 1 on any unresolved import. Walks apps/api/src, apps/api/test-support, modules/*/src, packages/*/src."""
import os, re, sys, glob
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')); os.chdir(ROOT)
IMP = re.compile(r"""(?:from\s+|import\(\s*|require\(\s*|vi\.mock\(\s*)['"](\.[^'"]+)['"]""")
bad = []
# Test files, *.pgtest.ts files and apps/api/scripts/*.ts are all outside tsc: moving a file breaks them silently. The
# dev scripts lost 129 imports that way across this arc (kysely.types, password, rbac, ...) before this check covered them.
KNOWN_DEAD: set = set()   # super-admin-stack.pgtest.ts (dead since before Constitution 13) was deleted in the open-items close-out
files = [f for pat in ('apps/api/src/**/*.ts', 'apps/api/test-support/**/*.ts', 'modules/*/src/**/*.ts', 'packages/*/src/**/*.ts') for f in glob.glob(pat, recursive=True) if re.search(r'\.(spec|test|pgtest)\.ts$', f)]
files += glob.glob('apps/api/scripts/*.ts')
files = [f for f in files if f not in KNOWN_DEAD]
for f in files:
    for m in IMP.finditer(open(f, encoding='utf-8').read()):
        if re.search(r'[*?()\[\]|\\]', m.group(1)): continue   # a regex inside a guard's source text, not an import
        t = os.path.normpath(os.path.join(os.path.dirname(f), m.group(1)))
        if not any(os.path.exists(t + ext) for ext in ('', '.ts', '.tsx', '.js', '.mjs', '/index.ts')): bad.append(f'{f}: {m.group(1)}')
# Literal 'src/<dir>/<file>.ts' paths handed to readFileSync/existsSync (guards that read another file's source). The
# path must exist under apps/api, under some other app (frontend guards use APPS_ROOT/<app>/src/...), or under a
# module's src (the security lane runs module specs from the module). customer-phone-bypass read the moved CRM
# repository this way and failed to LOAD, dropping its tests from the count.
# 'src/<dir>/<file>.ts' AND top-level 'src/<file>.ts' (tech-app-access read 'src/app.module.ts' from inside a module)
LIT = re.compile(r"""['"](src/(?:[a-z0-9-]+/)?[a-z0-9.-]+\.ts)['"]""")
# join(SRC, '<dir>/<file>.ts') and join(process.cwd(), 'src', '<dir>/...') name a source file WITHOUT the 'src/' prefix;
# schema-guard read tenant-navigation that way and would have failed to LOAD once it moved.
LIT_SRC = re.compile(r"""(?:join\(\s*SRC\s*,|\bread\(|\bsrc\(|\bs\()\s*['"]([a-z0-9-]+/[a-z0-9./-]+\.ts)['"]""")   # join(SRC, …) and the read()/src()/s() helpers guards define over it
roots = ['apps/api'] + [d for d in glob.glob('apps/*') if os.path.isdir(d)] + [d for d in glob.glob('modules/*') if os.path.isdir(d)]
for f in files + glob.glob('apps/api/scripts/*.mjs'):
    if not os.path.exists(f): continue
    text = open(f, encoding='utf-8').read()
    # A literal that is not under apps/api only resolves at run time if the file reads it through sourcePath() (which
    # falls back to the owning module), runs it from a module (the security lane), or joins it to another app's root.
    tolerant = 'sourcePath(' in text or f.endswith('security-audit.mjs') or 'APPS_ROOT' in text
    for m in list(LIT.finditer(text)) + [type('M', (), {'group': lambda self, i, v=x.group(1): v if v.startswith('src/') else 'src/' + v})() for x in LIT_SRC.finditer(text)]:
        lit = m.group(1)
        home = re.match(r'(modules/[^/]+|apps/[^/]+)/', f)   # a literal resolves against the root its suite RUNS from
        if home and os.path.exists(os.path.join(home.group(1), lit)): continue
        # apps/api's copy only counts for a file whose suite RUNS from apps/api — a module's suite runs from the module,
        # where 'src/app.module.ts' does not exist (tech-app-access passed this check that way and failed to load)
        if not (home and home.group(1).startswith('modules/')) and os.path.exists(os.path.join('apps/api', lit)): continue
        # frontend-app guards join an app name in front of the literal (APPS_ROOT/<app>/src/..., __dirname/../../../<app>/src/...)
        if lit.startswith('src/api/') and any(os.path.exists(os.path.join(d, lit)) for d in glob.glob('apps/*')): continue
        if tolerant and any(os.path.exists(os.path.join(r, lit)) for r in roots): continue
        bad.append(f'{f}: literal {lit} is not under apps/api' + ('' if tolerant else ' and this file does not read through sourcePath()'))
print('\n'.join(bad)); print(f'spec imports: {len(bad)} unresolved in {len(files)} test files'); sys.exit(1 if bad else 0)
