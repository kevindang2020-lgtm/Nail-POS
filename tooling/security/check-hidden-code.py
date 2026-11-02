#!/usr/bin/env python3
"""check-hidden-code.py — no code hidden where a person reading the file would not see it.

Why (Sep 2026): a developer handoff arrived with ~32 KB of obfuscated malware in eslint.config.mjs, placed after
thousands of tab characters at the end of an ordinary line, so an editor showed a normal file. ESLint runs its config
on every lint and in every editor with the plugin, so the malware ran on each. It was caught only because it happened
to carry a GitHub token (the secret scan). This audit catches the disguise itself.

Fails on, in tracked files:
  1. a run of 200+ spaces/tabs between two visible characters on one line (legitimate alignment in this repo peaks at
     78 — measured Sep 30 2026);
  2. a line over 1,000 characters in a file tools EXECUTE automatically: *.config.*, .eslintrc*, package.json,
     git hooks (.husky/*, .githooks/*);
  3. an install-time script (preinstall / install / postinstall) in any package.json — these run on `npm install`;
  4. the marker of the Sep 2026 malware family;
  5. a raw Unicode bidirectional-override character (U+202A-U+202E, U+2066-U+2069: "Trojan Source", CVE-2021-42574) in
     a code file — it reorders how an editor DISPLAYS a line so the reviewed text differs from what the compiler reads.
     Code that must match or strip such characters writes them as \\uXXXX escapes (malware scan, Oct 26 2026).
Exit 1 lists every hit. Scans code and config only (docs may quote the marker).
"""
import re
import subprocess
import sys

CODE = re.compile(r'\.(m?js|cjs|jsx|tsx?|json|ya?ml|sh|py|html|css|sql)$')
AUTORUN = re.compile(r'(^|/)([^/]*\.config\.[^/]+|\.eslintrc[^/]*|package\.json|\.husky/[^/]+|\.githooks/[^/]+)$')
HIDDEN_RUN = re.compile(r'\S[ \t]{200,}\S')
INSTALL_SCRIPT = re.compile(r'"(preinstall|install|postinstall)"\s*:')
# built from parts so this file does not match itself
MARKER = re.compile(r'\bglobal' + r'\.i\s*=\s*[\'"`]')
BIDI = re.compile('[\u202a-\u202e\u2066-\u2069]')
SELF = 'tooling/security/check-hidden-code.py'
AUTORUN_MAX = 1000


def scan(files):
    hits = []
    for f in files:
        if f == SELF or not (CODE.search(f) or AUTORUN.search(f)):
            continue
        try:
            with open(f, encoding='utf-8', errors='replace') as fh:
                text = fh.read()
        except (FileNotFoundError, IsADirectoryError):
            continue
        autorun = bool(AUTORUN.search(f))
        for n, line in enumerate(text.split('\n'), 1):
            m = HIDDEN_RUN.search(line)
            if m:
                hits.append(f'{f}:{n}: {len(m.group(0)) - 2} whitespace characters hide text after column {m.start() + 1}')
            if autorun and len(line) > AUTORUN_MAX:
                hits.append(f'{f}:{n}: {len(line)}-character line in a file tools execute automatically')
            if MARKER.search(line):
                hits.append(f'{f}:{n}: marker of the Sep 2026 developer-targeting malware')
            m = BIDI.search(line)
            if m:
                hits.append(f'{f}:{n}: raw bidirectional-override character U+{ord(m.group(0)):04X} at column {m.start() + 1} (write it as a \\u escape)')
        if f.endswith('package.json'):
            for m in INSTALL_SCRIPT.finditer(text):
                hits.append(f'{f}: "{m.group(1)}" script runs on npm install — not allowed')
    return hits


def main():
    files = subprocess.run(['git', 'ls-files'], capture_output=True, text=True, check=True).stdout.split('\n')
    hits = scan([f for f in files if f])
    if hits:
        print(f'check-hidden-code: {len(hits)} problem(s)')
        for h in hits:
            print('  ' + h)
        return 1
    print('check-hidden-code: no hidden code, no bidi overrides, no over-long lines in auto-run files, no install scripts')
    return 0


if __name__ == '__main__':
    sys.exit(main())
