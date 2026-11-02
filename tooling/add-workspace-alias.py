#!/usr/bin/env python3
"""add-workspace-alias.py — wire a workspace package into an app's tsconfig paths, vite and vitest aliases.

Constitution 13 §175 (aliases resolve to a package's PUBLIC entry — src/index.ts — never an internal path) and §219
(import migration done by a tool, not by hand, per app). Anchors on the existing @aipowersalon/realtime-client entry,
which every app declares; refuses (exit 1) if an anchor is missing rather than guessing.
  usage: tooling/add-workspace-alias.py <package-name-without-scope> <app> [<app> ...]
"""
import json, re, sys, os
pkg, apps = sys.argv[1], sys.argv[2:]
name = f"@aipowersalon/{pkg}"
ok = True
for a in apps:
    base = f"apps/{a}"
    ts = f"{base}/tsconfig.json"; s = open(ts, encoding="utf-8").read()
    if name not in s:
        anchor = '"@aipowersalon/realtime-client": ["../../packages/realtime-client/src/index.ts"]'
        if anchor not in s: print(f"{a}: tsconfig anchor missing"); ok = False; continue
        s = s.replace(anchor, anchor + f', "{name}": ["../../packages/{pkg}/src/index.ts"]', 1)
        open(ts, "w", encoding="utf-8").write(s)
    for cfg in (f"{base}/vite.config.ts", f"{base}/vitest.config.ts"):
        if not os.path.exists(cfg): continue
        s = open(cfg, encoding="utf-8").read()
        if name in s: continue
        m = re.search(r"'@aipowersalon/realtime-client': fileURLToPath\(new URL\('\.\./\.\./packages/realtime-client/src', import\.meta\.url\)\)", s)
        if not m: print(f"{a}: alias anchor missing in {cfg}"); ok = False; continue
        s = s[:m.end()] + f", '{name}': fileURLToPath(new URL('../../packages/{pkg}/src', import.meta.url))" + s[m.end():]
        open(cfg, "w", encoding="utf-8").write(s)
    pj = f"{base}/package.json"; d = json.load(open(pj))
    d.setdefault("dependencies", {})[name] = "*"
    json.dump(d, open(pj, "w"), indent=2); open(pj, "a").write("\n")
    wired = [os.path.basename(c) for c in (ts, f"{base}/vite.config.ts", f"{base}/vitest.config.ts") if os.path.exists(c) and name in open(c).read()]
    print(f"{a}: wired in {', '.join(wired)}")
sys.exit(0 if ok else 1)
