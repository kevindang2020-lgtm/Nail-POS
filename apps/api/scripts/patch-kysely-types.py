#!/usr/bin/env python3
# One-shot patcher: adds schema columns missing from src/database/kysely.types.ts interfaces.
# Purely additive — existing declarations are untouched. Conventions mirror the existing file:
#   text/uuid -> string | int2/int4/int8 -> number | bool -> boolean | jsonb/json -> unknown
#   timestamptz/timestamp NOT NULL default -> Ts ; nullable -> TsNull
#   date -> ColumnType<string, string, string> (nullable: ColumnType<string|null,...>)
#   NOT NULL + default -> Generated<T> ; nullable + default -> Generated<T | null>
import json, re, sys

SRC = 'src/database/kysely.types.ts'
src = open(SRC).read()
schema = json.load(open('/tmp/schema.json'))

def base_ts(udt):
    if udt in ('text', 'varchar', 'citext', 'uuid', 'inet', 'bpchar'): return 'string'
    if udt in ('int2', 'int4', 'int8', 'numeric', 'float8'): return 'number'
    if udt == 'bool': return 'boolean'
    if udt in ('jsonb', 'json'): return 'unknown'
    if udt.startswith('_'): return base_ts(udt[1:]) + '[]'
    return None

def col_type(c):
    udt, nullable, dflt = c['udt'], c['nullable'], c['hasDefault']
    if udt in ('timestamptz', 'timestamp'):
        return 'TsNull' if nullable else 'Ts'
    if udt == 'date':
        if nullable: return 'ColumnType<string | null, string | null, string | null>'
        return 'Generated<ColumnType<string, string, string>>' if dflt else 'ColumnType<string, string, string>'
    b = base_ts(udt)
    if b is None:
        sys.exit(f'UNMAPPED UDT {udt} for {c}')
    if b == 'unknown':
        return 'Generated<unknown>' if dflt else 'unknown'
    if dflt:
        return f'Generated<{b} | null>' if nullable else f'Generated<{b}>'
    return f'{b} | null' if nullable else b

dbm = re.search(r'export interface DB \{([\s\S]*?)\n\}', src)
declared = dict(re.findall(r'^\s+([a-z0-9_]+):\s*(\w+);', dbm.group(1), re.M))

patched_tables = 0
patched_cols = 0
for t, iface in declared.items():
    if t not in schema: continue
    m = re.search(r'(export interface ' + iface + r' \{)([^}]*)(\})', src)
    if not m: sys.exit(f'no body for {iface}')
    existing = set(re.findall(r'([a-z0-9_]+)\s*:', m.group(2)))
    missing = [c for c in schema[t] if c['name'] not in existing]
    if not missing: continue
    decls = ' '.join(f'{c["name"]}: {col_type(c)};' for c in missing)
    body = m.group(2)
    if '\n' in body:  # multi-line interface: add as a new indented line before }
        new_body = body.rstrip() + '\n  ' + decls + '\n'
    else:             # one-line interface: extend inline
        new_body = body.rstrip() + ' ' + decls + ' '
    src = src[:m.start()] + m.group(1) + new_body + m.group(3) + src[m.end():]
    patched_tables += 1
    patched_cols += len(missing)

open(SRC, 'w').write(src)
print(f'patched {patched_cols} columns across {patched_tables} tables')
