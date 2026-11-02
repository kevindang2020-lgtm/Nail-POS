# rls-readiness.py — static map of tenant tables vs cross-salon code paths (RLS_READINESS.md). Run from the repo root.
import re,glob,collections,json
sqls=''.join(open(f,encoding='utf-8',errors='ignore').read() for f in sorted(glob.glob('apps/api/db/migrations/*.sql')))
tables=set(m.group(1).lower() for m in re.finditer(r"CREATE TABLE(?: IF NOT EXISTS)?\s+([a-z0-9_]+)\s*\(([\s\S]*?)\n\);",sqls) if re.search(r"^\s*tenant_id\s",m.group(2),re.M))
tables|=set(m.group(1).lower() for m in re.finditer(r"ALTER TABLE\s+([a-z0-9_]+)\s+ADD COLUMN(?: IF NOT EXISTS)?\s+tenant_id",sqls,re.I))
files=[f for f in glob.glob('modules/*/src/**/*.ts',recursive=True)+glob.glob('apps/api/src/**/*.ts',recursive=True)+glob.glob('packages/*/src/**/*.ts',recursive=True) if not re.search(r'\.(spec|test)\.ts$',f)]
# code that reads ACROSS salons inside a TENANT (non-Super-Admin) request, by design — RLS keyed on the request's salon would break it
CROSS={'global technician profiles':r'/tech-profile/|/nail-showcase/|/tech/tech\.',
 'customer app / customer identity (a customer spans salons)':r'/customer/|/customer-identity/|/customer-salons/|/customer-booking/|/customer-registration/|/customer-payments/|/wallet/',
 'owner multi-salon portfolio':r'/owner-portfolio/|/owner/',
 'shared gift-card programs (redeemed at another salon)':r'/gift-cards/|/checkout/checkout\.kysely',
 'deals marketplace (nearby salons)':r'/deals/|/salon-promotions/|/bundles/',
 'go check-in / display devices (keyed by device)':r'/go-check-in/|/customer-display/',
 'safety community (cross-salon reports)':r'/tenant-safety-community/'}
use=collections.defaultdict(set); cross=collections.defaultdict(set)
for f in files:
    if re.search(r'super-admin|super_admin',f): continue
    s=open(f,encoding='utf-8',errors='ignore').read()
    hit=set(re.findall(r"(?:selectFrom|updateTable|deleteFrom|insertInto)\(\s*['\"`]([a-z0-9_]+)",s))|set(m.lower() for m in re.findall(r"\b(?:from|join|update|into)\s+([a-z0-9_]+)\b",s,re.I))
    for t in hit & tables:
        use[t].add(f)
        for label,rx in CROSS.items():
            if re.search(rx,f): cross[t].add(label)
unused=sorted(tables-set(use))
ready=sorted(t for t in use if not cross[t]); review=sorted(t for t in use if cross[t])
json.dump({'ready':ready,'review':{t:sorted(cross[t]) for t in review},'unused':unused},open('/tmp/rls_ready.json','w'),indent=1)
print(f"tenant tables {len(tables)}: used outside Super Admin {len(use)} | no cross-salon code path {len(ready)} | touched by a cross-salon path {len(review)} | not referenced {len(unused)}")
print('cross-salon reasons:', collections.Counter(l for v in cross.values() for l in v).most_common())
print('high-value READY sample:', [t for t in ['tickets','payments','ticket_service_lines','pos_tech_appointments','appointments','services','technicians','pos_queue_items','receipts','payment_refunds','cash_drawer_sessions','invoices','tenant_settings','customers'] if t in ready])
print('high-value needing review:', {t:sorted(cross[t]) for t in ['tickets','payments','customers','services','technicians','pos_tech_appointments'] if t in cross})

# ── statement level: tenant predicates that are NOT on the request's tenant ─────────────────────────────────────────────
# Row-level security keys every query to the REQUEST's salon, so a statement that filters on ANOTHER tenant value (an IN
# list across salons, an issuing salon, a tenant looked up from a row) breaks under it unless it runs in runAcrossTenants.
# Trusted: ctx/scope/actor .tenantId, a bare tenantId parameter, tid(ctx), and a local alias `const x = ctx.tenantId`.
# "passed-in" (input./args./opts.tenantId) is listed separately — its caller decides; review the caller.
def foreign_tenant_predicates():
    trust = re.compile(r"^(?:ctx|c|scope|s|a|actor|tc|context|req\.ctx)\.tenantId!?$|^tenantId$|^tid\(ctx\)?$|^String\(ctx\.tenantId\)$")
    out = collections.defaultdict(list)
    for f in files:
        if re.search(r'super-admin|super_admin', f): continue
        s = open(f, encoding='utf-8', errors='ignore').read()
        aliases = set(re.findall(r"const (\w+)\s*=\s*(?:ctx|scope|actor)\.tenantId\b", s))
        for m in re.finditer(r"where\(\s*'(?:[a-z_]+\.)?tenant_id'\s*,\s*'(=|in)'\s*,\s*([^)]{1,60})\)", s):
            op, rhs = m.group(1), re.sub(r"\s+as\s+any$", "", m.group(2).strip())
            if op == '=' and (trust.match(rhs) or rhs in aliases): continue
            if 'runAcrossTenants' in s[max(0, m.start() - 3000):m.start()]: continue
            prev = list(re.finditer(r"(?:selectFrom|updateTable|deleteFrom)\(\s*'([a-z0-9_]+)", s[:m.start()]))
            kind = 'passed-in' if re.match(r"^(input|args|opts|params|p|q|row|b)\.tenantId$", rhs) else ('IN-list' if op == 'in' else 'other value')
            out[prev[-1].group(1) if prev else '?'].append((f.split('/src/')[-1] + ':' + str(s.count('\n', 0, m.start()) + 1), kind, rhs[:50]))
    return out

if __name__ == '__main__':
    fp = foreign_tenant_predicates()
    rows = sorted(((t, x) for t, v in fp.items() for x in v), key=lambda r: (r[1][1] != 'IN-list', r[1][1] != 'other value', r[0]))
    print(f"\nstatement level: {sum(len(v) for v in fp.values())} tenant predicates not on the request tenant, across {len(fp)} tables")
    for k in ('IN-list', 'other value', 'passed-in'): print(f"  {k}: {sum(1 for _, x in rows if x[1] == k)}")
    json.dump({t: v for t, v in fp.items()}, open('/tmp/rls_foreign.json', 'w'), indent=1)
