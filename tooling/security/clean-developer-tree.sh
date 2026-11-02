#!/usr/bin/env bash
# clean-developer-tree.sh — removes the malware found in the developer's Oct 6 2026 tree (Power-Salon-main).
#
# Run it from the ROOT of that repository checkout, ON A CLEAN MACHINE, BEFORE any `npm install`, `npm run`, `npx eslint`
# or opening the folder in an editor with an ESLint extension (each of those runs the payload):
#     bash clean-developer-tree.sh
# It only edits / deletes files and prints what it did; it runs nothing from the repository.
set -euo pipefail
[ -f package.json ] && [ -d apps ] || { echo "Run this from the root of the Power-Salon repository."; exit 2; }
changed=0

# 1. the obfuscated payload file the root scripts ran
if [ -f api.js ]; then rm -f api.js; echo "removed  api.js (obfuscated payload)"; changed=1; fi

# 2. the payload hidden at the end of eslint.config.mjs (pushed off-screen by thousands of spaces/tabs)
for f in eslint.config.mjs eslint.config.js eslint.config.cjs .eslintrc.js .eslintrc.cjs; do
  [ -f "$f" ] || continue
  if grep -qE '[[:space:]]{200,}[^[:space:]]' "$f"; then
    sed -i.bak -E 's/[[:space:]]{200,}[^[:space:]].*$//' "$f" && rm -f "$f.bak"
    echo "cleaned  $f (hidden code after a long run of whitespace removed)"; changed=1
  fi
  # the injector also added a CommonJS `require` shim the payload needed; nothing else in the config uses it
  if grep -q "createRequire" "$f" && [ "$(grep -c 'require(' "$f")" = "0" ]; then
    sed -i.bak -E "/^import \{ createRequire \} from 'module';$/d; /^const require = createRequire\(import\.meta\.url\);$/d" "$f" && rm -f "$f.bak"
    cat -s "$f" > "$f.tmp" && mv "$f.tmp" "$f"
    echo "cleaned  $f (unused require shim the payload relied on removed)"; changed=1
  fi
done

# 3. the root package.json scripts that ran `node api.js` before the real build / dev
if grep -q 'node api\.js' package.json; then
  sed -i.bak -E 's/node api\.js &&[[:space:]]*//g' package.json && rm -f package.json.bak
  echo "cleaned  package.json (\"build\" / \"dev\" no longer run node api.js)"; changed=1
fi

# 4. the committed Firebase service-account PRIVATE KEY (revoke it in the Firebase console too — deleting is not enough)
if [ -f apps/api/firebase-admin.json ]; then
  rm -f apps/api/firebase-admin.json; echo "removed  apps/api/firebase-admin.json (private key — REVOKE it in Firebase)"; changed=1
fi
grep -qxF 'apps/api/firebase-admin.json' .gitignore 2>/dev/null || { echo 'apps/api/firebase-admin.json' >> .gitignore; echo "added    apps/api/firebase-admin.json to .gitignore"; }

# 5. verify — nothing of the kind is left anywhere in tracked source (node_modules / dist excluded)
left=$(grep -rlE '[[:space:]]{200,}[^[:space:]]|_0x[0-9a-f]{4,}|global\[.!.\]' \
        --include='*.js' --include='*.mjs' --include='*.cjs' --include='*.ts' --include='*.tsx' --include='*.json' \
        --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git . 2>/dev/null || true)
runner=$(grep -nE '"(pre|post)?install"|node [^/" ]+\.(m|c)?js' package.json || true)
if [ -n "$left$runner" ]; then
  echo; echo "STILL SUSPICIOUS — do not run anything; send these to Kevin:"; echo "$left"; echo "$runner"; exit 1
fi
echo; [ $changed = 1 ] && echo "CLEAN — the injected code is gone. Commit the change, then delete node_modules and reinstall." || echo "CLEAN — nothing to remove."
