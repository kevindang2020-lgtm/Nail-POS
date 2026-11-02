#!/usr/bin/env python3
# check-auth-logging.py — no ad-hoc console output in the sign-in and session code (Constitution 3 / 12).
# Oct 3 2026: three developer debug lines were found in that path in one day — the whole customer identity record
# (incl. its password hash), every login attempt's email/phone and outcome, and every sign-in decision's facts. Logging
# there goes through the structured logger and the security/auth event stores, never console.log/info/debug.
import os, re, sys
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
SCAN = ['modules/identity/src', 'apps/api/src/common/tenant-context.middleware.ts', 'packages/auth/src', 'packages/api-client/src', 'packages/mobile-sdk/src']
BAD = re.compile(r'\bconsole\.(log|info|debug)\s*\(')
bad = []
for target in SCAN:
    p = os.path.join(ROOT, target)
    files = [p] if os.path.isfile(p) else [os.path.join(d, f) for d, _, fs in os.walk(p) for f in fs]
    for f in files:
        if not re.search(r'\.(ts|tsx|mjs|js)$', f) or re.search(r'\.(spec|test)\.|/dist/|node_modules', f): continue
        for i, line in enumerate(open(f, encoding='utf-8', errors='replace'), 1):
            code = line.split('//')[0]
            if BAD.search(code): bad.append(f'{os.path.relpath(f, ROOT)}:{i}: {line.strip()[:120]}')
if bad:
    print('auth logging: console output in sign-in/session code (use the structured logger or the auth/security events):')
    for b in bad: print('  ' + b)
    sys.exit(1)
print('auth logging: no console output in sign-in/session code')
