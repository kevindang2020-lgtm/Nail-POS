#!/usr/bin/env python3
"""audit-entries.py — Constitution 13 §97: every name the API (or another module) imports from @aipowersalon/<module>
must be exported by that module's public entry. The codemod derives entries from inbound imports, and has missed names
three ways (a file that also defines a Nest module; a dynamic import; colliding DTOs). Exit 1 on any miss.

  tooling/modules/audit-entries.py            report
"""
import os, re, glob, sys
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')); os.chdir(ROOT)
bad = 0
for m in sorted(os.listdir('modules')):
    idx = open(f'modules/{m}/src/index.ts', encoding='utf-8').read(); exported = set()
    for mm in re.finditer(r"export (?:type )?\{([^}]*)\}", idx):   # `export type { A } from …` in the entry counts too
        exported |= {re.sub(r'^\s*type\s+', '', n).strip().split(' as ')[-1].strip() for n in mm.group(1).split(',') if n.strip()}
    for mm in re.finditer(r"export \* from '\./([^']+)'", idx):
        body = open(f'modules/{m}/src/{mm.group(1)}.ts', encoding='utf-8').read()
        exported |= set(re.findall(r'^export (?:declare )?(?:const|function|class|interface|type|enum|async function|abstract class) (\w+)', body, re.M))
        # re-exports inside the file (`export type { A, B } from '...'`, `export { C }`) count too — a DTO that re-exports
        # api-contracts types was reported as missing them (a false alarm; tsc had it right)
        for rm in re.finditer(r'^export (?:type )?\{([^}]*)\}', body, re.M):
            exported |= {re.sub(r'^\s*type\s+', '', n).strip().split(' as ')[-1].strip() for n in rm.group(1).split(',') if n.strip()}
    for f in glob.glob('apps/api/src/**/*.ts', recursive=True) + [x for x in glob.glob('modules/*/src/**/*.ts', recursive=True) if not x.startswith(f'modules/{m}/')]:
        text = open(f, encoding='utf-8').read()
        # static imports AND `const { A, B } = await import('@aipowersalon/<m>')` (the codemod rewrites dynamic imports too)
        for mm in list(re.finditer(r"import (?:type )?\{([^}]*)\} from '@aipowersalon/" + re.escape(m) + "'", text)) + list(re.finditer(r"\{([^{}]*)\}\s*=\s*await import\(\s*'@aipowersalon/" + re.escape(m) + r"'\s*\)", text)):
            for n in mm.group(1).split(','):
                n = re.sub(r'^\s*type\s+', '', n).strip().split(' as ')[0].split(':')[0].strip()   # `{ A as B }` and destructured `{ A: B }`
                if n and n not in exported: print(f'{f}: {n} is not exported by @aipowersalon/{m}'); bad += 1
print(f'module entries: {bad} missing export(s)'); sys.exit(1 if bad else 0)
