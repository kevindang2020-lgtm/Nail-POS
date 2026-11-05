#!/usr/bin/env python3
"""check-db-credentials.py — no real server address or database login is committed.

Why (Oct 6 2026): 35 tracked files carried the login and public address of an outside Postgres server, most as the
silent fallback when DATABASE_URL was unset — so `node scripts/clean-bookings.mjs` with no environment emptied tables
on that server. They now require DATABASE_URL and stop when it is missing. This audit keeps that from coming back.

Fails on, in tracked files:
  1. the address of the Oct 2026 server, anywhere (docs included);
  2. in code/config: a connection URL (postgres, mysql, mongodb, redis, amqp) whose host is a PUBLIC IPv4 address;
  3. in code/config: a connection URL with a user:password@ login whose host is a real-looking domain and whose
     password is not an obvious placeholder (tests use u:p@… and reserved names such as db.example.com);
  4. in code/config: a `host` / `hostname` set to a public IPv4 literal.
Local and reserved names pass: localhost, loopback / private / documentation ranges, one-label Docker service names
(db, postgres), and *.example.com, *.test, *.invalid, *.local, *.internal, *.localhost. Values built from the
environment (${...}, $VAR) pass. Exit 1 lists every hit.
"""
import ipaddress
import re
import subprocess
import sys

SELF = 'tooling/security/check-db-credentials.py'
CODE = re.compile(r'(\.(m?js|cjs|jsx|tsx?|json|ya?ml|sh|py|sql|toml|ini|conf)$)|(^|/)\.env[^/]*$|(^|/)Dockerfile[^/]*$')
# built from parts so this file does not match itself
LEAKED = re.compile(r'\b18\.118' + r'\.14\.115\b')
URL = re.compile(r'\b(postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?)://([^\s\'"`/@]*@)?([^\s\'"`/:?]+)')
HOST_KEY = re.compile(r'\b(host|hostname|HOST|PGHOST|DB_HOST)\b\s*[:=]\s*[\'"]?((?:\d{1,3}\.){3}\d{1,3})\b')
RESERVED_SUFFIX = ('.example.com', '.example', '.test', '.invalid', '.local', '.internal', '.localhost')
PLACEHOLDER_PW = {'p', 'pw', 'pass', 'password', 'secret', 'changeme', 'xxx', 'x', '***', '****', 'redacted'}


def public_ip(host):
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_global


def real_domain(host):
    h = host.lower().strip('[]')
    if h == 'localhost' or '.' not in h or re.fullmatch(r'[\d.:]+', h):
        return False   # local, a one-label Docker service name, or an IP literal (public ones are rule 2)
    return not h.endswith(RESERVED_SUFFIX)


def check_line(line):
    hits = []
    for m in URL.finditer(line):
        login, host = m.group(2) or '', m.group(3)
        if '$' in host or '{' in host or '$' in login or '{' in login:
            continue
        if public_ip(host):
            hits.append(f'connection URL to a public address ({m.group(1)}://…@{host})')
        elif login and ':' in login and real_domain(host):
            pw = login[:-1].split(':', 1)[1]
            if pw.lower() not in PLACEHOLDER_PW and len(pw) > 2:
                hits.append(f'connection URL with a login to a real host ({m.group(1)}://…@{host})')
    for m in HOST_KEY.finditer(line):
        if public_ip(m.group(2)):
            hits.append(f'{m.group(1)} set to a public address ({m.group(2)})')
    return hits


def scan(files):
    out = []
    for f in files:
        if f == SELF or f.endswith('package-lock.json'):
            continue
        try:
            with open(f, encoding='utf-8', errors='replace') as fh:
                lines = fh.read().splitlines()
        except (FileNotFoundError, IsADirectoryError, UnicodeDecodeError):
            continue
        code = bool(CODE.search(f))
        for i, line in enumerate(lines, 1):
            if LEAKED.search(line):
                out.append(f'{f}:{i}: the address of the Oct 2026 outside database server')
            if code:
                out.extend(f'{f}:{i}: {h}' for h in check_line(line))
    return out


def main():
    files = subprocess.run(['git', 'ls-files'], capture_output=True, text=True, check=True).stdout.split('\n')
    files = [f for f in files if f]
    hits = scan(files)
    if hits:
        print('db credentials: FAIL — a real server address or database login is committed:')
        for h in hits:
            print('  ' + h)
        print('Read the connection from DATABASE_URL (and stop when it is unset); never default to a real server.')
        return 1
    print(f'db credentials: OK ({len(files)} tracked files, no real server address or database login)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
