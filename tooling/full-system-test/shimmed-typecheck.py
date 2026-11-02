#!/usr/bin/env python3
"""shimmed-typecheck.py — FullSystemTest.pdf (Oct 28 2026): type-check the whole backend when node_modules is missing.

Builds ONE TypeScript program over apps/api/src + modules/*/src + packages/*/src (no specs, no .tsx), maps every
@aipowersalon/* import to its source, and declares every third-party module the code imports as an untyped module
(`declare module 'x';`). The result checks the repository's OWN types against each other; anything typed by a missing
package (Kysely rows, Nest decorators, Express) is `any` and therefore NOT checked. It is a partial proof, never a
substitute for `npm run typecheck` with the real dependencies.

Usage: python3 tooling/full-system-test/shimmed-typecheck.py <out-dir>
       NODE_OPTIONS=--max-old-space-size=6144 node node_modules/typescript/bin/tsc -p <out-dir>/tsconfig.json --pretty false
Classify: TS2709 / TS7006 / TS2347 are shim effects by construction; read the rest by hand.
"""
import json, os, re, subprocess, sys

R = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else 'shimmed-typecheck')
os.makedirs(OUT, exist_ok=True)

paths = {}
for base in ('packages', 'modules'):
    for d in sorted(os.listdir(f'{R}/{base}')):
        pj = f'{R}/{base}/{d}/package.json'
        if not os.path.exists(pj):
            continue
        p = json.load(open(pj)); n = p['name']
        for k, v in (p.get('exports') or {'.': None}).items():
            if k == '.':
                paths[n] = [f'{R}/{base}/{d}/src/index.ts']
            elif not k.endswith('.css'):
                sub = k[2:]
                t = v.get('types') if isinstance(v, dict) else v
                cand = [f'{R}/{base}/{d}/src/{sub}/index.ts', f'{R}/{base}/{d}/src/{sub}.ts']
                if t:
                    cand.insert(0, f'{R}/{base}/{d}/' + re.sub(r'^\./dist/', 'src/', t).replace('.d.ts', '.ts'))
                paths[f'{n}/{sub}'] = [c for c in cand if os.path.exists(c)][:1] or cand[:1]
        paths[n + '/*'] = [f'{R}/{base}/{d}/src/*']

files = subprocess.run(['git', 'ls-files', 'apps/api/src', 'modules', 'packages'], cwd=R, capture_output=True, text=True).stdout.split()
SKIP_PKG = r'(?!ui|mobile-sdk|realtime-client|api-client|testing|web-push)'   # browser-side packages
src = [f for f in files if f.endswith('.ts') and not re.search(r'\.(test|spec)\.ts$|/test/|__tests__|\.d\.ts$', f)
       and re.match(rf'(apps/api/src|modules/[^/]+/src|packages/{SKIP_PKG}[^/]+/src)/', f)]

IMPORT = re.compile(r'''(?:\bfrom\s+|\bimport\s+|\bimport\(\s*|\brequire\(\s*)['"]((?:@[a-z0-9._-]+/)?[a-z0-9_-][a-z0-9._-]*(?:/[A-Za-z0-9._/-]+)?|node:[a-z/_]+)['"]''')
ext = set()
for f in src:
    for m in IMPORT.finditer(open(f'{R}/{f}', encoding='utf8').read()):
        if not m.group(1).startswith('@aipowersalon/'):
            ext.add(m.group(1))

shim = '\n'.join(f"declare module '{e}';" for e in sorted(ext)) + '''
declare var process: any; declare var Buffer: any; declare var __dirname: string; declare var __filename: string;
declare var require: any; declare var module: any; declare var global: any;
type Buffer = any; type NodeRequire = any;
declare namespace NodeJS { type ProcessEnv = Record<string, string | undefined>; type Timeout = any; type Timer = any; type Immediate = any;
  type ErrnoException = Error & { code?: string; errno?: number; syscall?: string; path?: string }; type ReadableStream = any;
  type WritableStream = any; type Signals = string; type Process = any; type Require = any; type Module = any; type CallSite = any; }
'''
open(f'{OUT}/shims.d.ts', 'w').write(shim)
cfg = {'compilerOptions': {'target': 'ES2021', 'module': 'commonjs', 'moduleResolution': 'node', 'strict': True, 'esModuleInterop': True,
                           'experimentalDecorators': True, 'skipLibCheck': True, 'noEmit': True, 'resolveJsonModule': True, 'types': [],
                           'lib': ['ES2023', 'DOM', 'DOM.Iterable'], 'ignoreDeprecations': '6.0', 'baseUrl': R, 'paths': paths},
       'files': [f'{OUT}/shims.d.ts'] + [f'{R}/{f}' for f in src]}
json.dump(cfg, open(f'{OUT}/tsconfig.json', 'w'), indent=1)
print(f'{len(src)} files; {len(ext)} external modules declared untyped → {OUT}/tsconfig.json')
