#!/usr/bin/env python3
"""move-contracts.py — Constitution 13 §13–15, §219–220: move API response types into packages/api-contracts.

For one frontend API-client file, finds every exported type it re-declares that the API also declares, takes the
API's declaration TEXT (the API is authoritative, §320), adds any types those reference (closure), and:
  - writes them into packages/api-contracts/src/<realm>/<group>.ts   (types only; the package is built like the others and apps/api reads dist — never source, never part
    of apps/api's rootDir — a .ts file here would move dist/main.js; see apps/api/tsconfig.json "rootDir")
  - removes them from each API file, which instead `import type`s and `export type`s them (API importers unchanged)
  - removes the frontend copies; the client file re-exports them from the contract (app importers unchanged)
Types whose frontend copy DIFFERS from the API are refused unless listed in --adjudicated (each needs a reason in the
commit), and names the frontend uses differently are handled by --rename FE=API.

  usage: move-contracts.py --client apps/owner-web/src/api/ownerApi.ts --realm tenant
                           [--adjudicated A,B] [--rename BonusRule=BonusRuleRow] [--tighten 'Type.field=NewType'] [--apply]
Without --apply it only reports (dry run).
"""
import argparse, os, re, sys, collections, json
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
API = os.path.join(ROOT, 'apps/api/src')
PKG = os.path.join(ROOT, 'packages/api-contracts/src')
ap = argparse.ArgumentParser()
ap.add_argument('--client', required=True); ap.add_argument('--realm', required=True)
ap.add_argument('--adjudicated', default=''); ap.add_argument('--rename', action='append', default=[])
ap.add_argument('--tighten', action='append', default=[]); ap.add_argument('--apply', action='store_true')
ap.add_argument('--skip', default='', help='comma list: app types that merely SHARE a name with an unrelated API type (app-side projections) — left in the app')
ap.add_argument('--explain', action='store_true', help='field-level diff of every refused type (what each side has that the other lacks)')
ap.add_argument('--prefer', action='append', default=[], help='Name=api/relative/path.ts — which API definition is the contract when a name is defined in 2+ API files (chosen by the route that serves the client call)')
a = ap.parse_args()
RENAME = dict(r.split('=') for r in a.rename); ADJ = set(filter(None, a.adjudicated.split(',')))
PREFER = dict(r.split('=') for r in a.prefer); SKIP = set(filter(None, a.skip.split(',')))

def files(base):
    for dp, _, fn in os.walk(base):
        if 'node_modules' in dp: continue
        for f in fn:
            if f.endswith(('.ts', '.tsx')) and not re.search(r'\.(test|spec|pgtest)\.', f) and not f.endswith('.d.ts'): yield os.path.join(dp, f)

DECL = re.compile(r'^export (interface|type) ([A-Z][A-Za-z0-9]*)\b', re.M)
def span(src, m):
    """(start, end) of the declaration, including an immediately preceding comment block and the trailing newline."""
    start = m.start()
    # absorb directly-preceding // lines or a /** */ block
    lines_before = src[:start].split('\n')[:-1]; k = len(lines_before)
    while k > 0 and re.match(r'\s*(//|\*|/\*\*|\*/)', lines_before[k - 1]): k -= 1
    cstart = len('\n'.join(lines_before[:k])) + (1 if k > 0 else 0) if k < len(lines_before) else start
    # Track nesting over a copy with comments blanked (same offsets): a `->` or `(honest)` inside a comment must not
    # count as a bracket. (Found when PlansOverview's `// ... -> UI renders honest gap` ended the type early.)
    blank = re.sub(r'//[^\n]*|/\*.*?\*/', lambda mm: ' ' * len(mm.group(0)), src, flags=re.S)
    i = m.end(); depth = 0; opened = False
    while i < len(src):
        c = blank[i]
        if c in '{(<[': depth += 1; opened = True
        elif c in '})>]': depth -= 1
        if depth == 0:
            if c == ';': i += 1; break
            if c == '}' and m.group(1) == 'interface': i += 1; break
            if c == '\n' and m.group(1) == 'type' and opened and not re.match(r'\s*[|&]', blank[i + 1:i + 40]): break
            if c == '\n' and m.group(1) == 'type' and not opened and not re.match(r'\s*[|&=]', blank[i + 1:i + 40]) and re.search(r'=\s*\S', blank[m.end():i]): break
        i += 1
    if i < len(src) and src[i] == '\n': i += 1
    return cstart, i

norm = lambda s: re.sub(r'[\s;,]+', '', re.sub(r'//[^\n]*|/\*.*?\*/', '', s, flags=re.S)).replace('export', '').replace('=|', '=').replace('"', "'")   # quote style is not drift
def index(base):
    d = collections.defaultdict(list)
    for f in files(base):
        s = open(f, encoding='utf-8').read()
        for m in DECL.finditer(s):
            st, en = span(s, m); d[m.group(2)].append({'file': f, 'text': s[st:en], 'decl': s[m.start():en]})
    return d


def fields_of(text):
    """top-level members of an interface/object-type literal → {name: type text}; a type alias that is not an object → {'=': text}."""
    body = re.sub(r'//[^\n]*|/\*.*?\*/', '', text, flags=re.S)
    i = body.find('{'); eq = body.find('=')
    if i < 0 or (0 <= eq < i and body[eq + 1:i].strip() and not body[eq + 1:i].strip().endswith('&')):
        return {'=': re.sub(r'\s+', ' ', body[eq + 1:] if eq >= 0 else body).strip(' ;')}
    out = {}; depth = 0; cur = ''
    head = body[:i]
    for c in body[i + 1:]:
        if c in '{(<[': depth += 1
        if c in '})>]':
            if depth == 0: break
            depth -= 1
        if c in ';,\n' and depth == 0:
            if ':' in cur: k, v = cur.split(':', 1); out[k.strip()] = re.sub(r'\s+', ' ', v).strip()
            cur = ''
        else: cur += c
    if ':' in cur: k, v = cur.split(':', 1); out[k.strip()] = re.sub(r'\s+', ' ', v).strip()
    ext = re.search(r'extends\s+([^{]+)', head)
    if ext: out['(extends)'] = ext.group(1).strip()
    return out

api = index(API)
for n, rel in PREFER.items():   # narrow an ambiguous name to the definition the route actually returns
    keep = [x for x in api.get(n, []) if os.path.relpath(x['file'], API) == rel]
    assert keep, f'--prefer {n}={rel}: no such definition'
    api[n] = keep
client = os.path.join(ROOT, a.client); csrc = open(client, encoding='utf-8').read()
fe = {m.group(2): csrc[m.start():span(csrc, m)[1]] for m in DECL.finditer(csrc)}
seed, refused = [], []
for name, text in fe.items():
    apiname = RENAME.get(name, name)
    if apiname not in api or name in SKIP: continue
    if len({x['file'] for x in api[apiname]}) > 1: refused.append((name, 'defined in 2+ API files')); continue
    if norm(text).replace(name, apiname, 1) != norm(api[apiname][0]['decl']) and name not in ADJ: refused.append((name, 'frontend copy differs — adjudicate')); continue
    seed.append(apiname)
# closure over API types referenced by the moved declarations
closure, seen, todo = [], set(), list(seed)
while todo:
    k = todo.pop(0)
    if k in seen or k not in api: continue
    seen.add(k); closure.append(k)
    body = re.sub(r"'[^']*'|\"[^\"]*\"", '', api[k][0]['decl'])
    for ref in set(re.findall(r'\b([A-Z][A-Za-z0-9]*)\b', body)):
        if ref != k and ref in api and ref not in seen:
            if len({x['file'] for x in api[ref]}) > 1: refused.append((ref, 'referenced, but defined in 2+ API files')); continue
            todo.append(ref)
group_of = lambda f: re.sub(r'\.(dto|service|repository|types?)$', '', os.path.basename(os.path.dirname(f)))
groups = collections.defaultdict(list)
for k in closure: groups[group_of(api[k][0]['file'])].append(k)
print(f"client {a.client}: {len(fe)} exported types, {len(seed)} move, closure adds {len(closure) - len(seed)} → {len(closure)} contract types")
print("groups:", {g: len(v) for g, v in groups.items()})
print("refused:", refused or 'none')
if a.explain:
    for name, why in refused:
        if 'adjudicate' not in why: continue
        f = fields_of(fe[name]); g = fields_of(api[RENAME.get(name, name)][0]['decl'])
        print(f"\n== {name}   (API: {os.path.relpath(api[RENAME.get(name, name)][0]['file'], API)})")
        for k in sorted(set(f) | set(g)):
            if k not in g: print(f"   only in APP : {k}: {f[k][:90]}")
            elif k not in f: print(f"   only in API : {k}: {g[k][:90]}")
            elif re.sub(r'\s', '', f[k]) != re.sub(r'\s', '', g[k]): print(f"   DIFFERS     : {k}:  app {f[k][:60]}  |  api {g[k][:60]}")
if not a.apply: sys.exit(0)
if any(r for r in refused if 'adjudicate' not in r[1]): print("refusing to apply with unresolved ambiguous types"); sys.exit(1)

# 1) write contract .ts files (types only)
os.makedirs(os.path.join(PKG, a.realm), exist_ok=True)
where = {k: g for g, ks in groups.items() for k in ks}
for g, ks in groups.items():
    body = []
    for k in ks:
        t = api[k][0]['text']
        for tg in a.tighten:
            tn, rest = tg.split('.', 1); field, new = rest.split('=')
            if tn == k: t2 = re.sub(r'(\b' + field + r'\s*:\s*)string\b', r'\g<1>' + new, t, count=1); assert t2 != t, tg; t = t2
        body.append(t.rstrip() + '\n')
    text = '\n'.join(body)
    refs = sorted({r for r in re.findall(r'\b([A-Z][A-Za-z0-9]*)\b', re.sub(r"'[^']*'", '', text)) if r in where and where[r] != g})
    imports = collections.defaultdict(list)
    for r in refs: imports[where[r]].append(r)
    head = f"// GENERATED FROM apps/api by tooling/contracts/move-contracts.py, then OWNED HERE (Constitution 13 §13).\n// Realm: {a.realm}. Declaration file: types only, never emitted (see packages/api-contracts/README.md).\n"
    head += ''.join(f"import type {{ {', '.join(v)} }} from './{og}';\n" for og, v in sorted(imports.items()))
    path = os.path.join(PKG, a.realm, g + '.ts')
    prev = open(path, encoding='utf-8').read() if os.path.exists(path) else ''
    open(path, 'w', encoding='utf-8').write((prev.rstrip() + '\n\n' + text) if prev else head + '\n' + text)
idx = os.path.join(PKG, a.realm, 'index.ts')
have = open(idx, encoding='utf-8').read() if os.path.exists(idx) else f"// @aipowersalon/api-contracts/{a.realm} — the {a.realm}-realm API contracts (Constitution 13 §14).\n"
for g in groups:
    line = f"export * from './{g}';\n"
    if line not in have: have += line
open(idx, 'w', encoding='utf-8').write(have)

# 2) API files: drop the declarations, import + re-export from the contract
byfile = collections.defaultdict(list)
for k in closure: byfile[api[k][0]['file']].append(k)
for f, ks in byfile.items():
    s = open(f, encoding='utf-8').read()
    for k in ks:
        m = re.search(r'^export (interface|type) ' + k + r'\b', s, re.M); st, en = span(s, m); s = s[:st] + s[en:]
    first = re.search(r'^import .*$', s, re.M)
    stmt = f"import type {{ {', '.join(ks)} }} from '@aipowersalon/api-contracts/{a.realm}';\nexport type {{ {', '.join(ks)} }};   // owned by packages/api-contracts (Constitution 13 §13)\n"
    s = (s[:first.start()] + stmt + s[first.start():]) if first else stmt + s
    open(f, 'w', encoding='utf-8').write(s)

# 3) frontend client: drop its copies, re-export from the contract
s = csrc; moved_fe = [n for n in fe if RENAME.get(n, n) in seed]
for n in moved_fe:
    m = re.search(r'^export (interface|type) ' + n + r'\b', s, re.M); st, en = span(s, m); s = s[:st] + s[en:]
names = sorted({RENAME.get(n, n) for n in moved_fe})
first = re.search(r'^import .*$', s, re.M)
stmt = f"import type {{ {', '.join(names)} }} from '@aipowersalon/api-contracts/{a.realm}';\nexport type {{ {', '.join(names)} }};   // the API's own contract (Constitution 13 §15) — never re-declare it here\n"
s = (s[:first.start()] + stmt + s[first.start():]) if first else stmt + s
open(client, 'w', encoding='utf-8').write(s)
json.dump({'moved': closure, 'renamed': RENAME, 'client': a.client}, open('/tmp/move-contracts-last.json', 'w'))
print("applied")
