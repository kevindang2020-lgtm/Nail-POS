# DEPENDENCY_SECURITY_REPORT.md — dependencies and supply chain (mandate §13–§14, §141–§148, §155)

Date: Oct 23 2026. Node 22.22.0, npm 10.9.4. npm workspace: 7 web apps (+ kiosk / display shells), the API, 31 domain modules,
~20 packages. Registry access worked; every number below is from a command run on this tree (exact commands at the end).

## 1. Before → after (npm audit)

| Scope | Before (scan letter B, morning) | After this batch |
|---|---|---|
| Production dependencies, workspace root (`npm audit --omit=dev`) | 4 critical, 14 high | **0 critical, 1 high** (kysely — reviewed, allowlisted, see §3), 10 moderate |
| Whole workspace incl. dev / build tools (`npm audit`) | 8 critical, 15 high | 2 critical, 2 high — all dev-only or allowlisted (§3) |

The production gate `npm run security:deps` (tooling/security/check-npm-audit.mjs) now runs on every push and pull request and
fails on any HIGH / CRITICAL production advisory not in tooling/security/npm-audit-allowlist.json (each entry has a reason and a
review-by date; an expired or unused entry fails too).

## 2. What changed

| Package | Before | After | Why |
|---|---|---|---|
| `force` (root dependency) | ^0.0.3 | **removed** | unused, abandoned; pulled `request` / `form-data` criticals (A6 / B3) |
| @capacitor/core, android, ios, cli (six apps) | 8.4.0 | 8.5.3 (^8.4.3) | GHSA-rvm3-566m-v7fv critical (B1) |
| capacitor-swift-pm (4 × Package.swift) | exact 8.4.0 | exact 8.5.3 | matches the installed iOS package (cap sync drift check) |
| compression (API) | 1.8.1 | 1.8.2 | memory-leak DoS |
| multer | 2.0.2 / `"*"` | 2.5.0 (override ^2.5.0; caret ranges) | 7 upload DoS advisories; wildcard range (B9) |
| qs | 6.14.2 | 6.16.1 (override) | array / bracket DoS |
| body-parser | 1.20.4 | 1.20.9 (override ^1.20.6) | limit bypass |
| @grpc/grpc-js (via firebase) | 1.9.16 | 1.14.6 (override) | server-side advisories (hygiene) |
| reflect-metadata | 0.2.1 (+ 5 nested lock entries without integrity) | 0.2.2, nested entries removed | deprecated "critical bug"; lock integrity (B8) |
| express (super-admin) | `"*"` | ^4.22.1 | wildcard range |
| react-router-dom (six SPAs) | 6.30.4 | 6.30.6 | open-redirect advisory (B11) |
| shell-quote / concurrently, @xmldom/xmldom, brace-expansion, js-yaml, source-map-js | vulnerable | fixed by `npm audit fix` (non-breaking) | dev / build tooling (B13) |
| @tailwindcss/vite, tailwindcss (pos-web) | `dependencies` | `devDependencies` | build tools — this is what put vite into the production audit |

## 3. Remaining advisories (all reviewed)

| Package | Severity | Scope | Reachability | Decision |
|---|---|---|---|---|
| kysely 0.27.6 — GHSA-wmrf-hv6w-mr66, GHSA-8cpq-38p9-67gx, GHSA-pv5w-4p9q-p3v2 | high | production | Not reachable: PostgreSQL only (the `sql.lit` advisory is MySQL escaping), no `JSONPathBuilder` / `->` JSON-path use anywhere in runtime code, and every non-literal `sql.lit` / `sql.raw` / `sql.ref` call site is frozen by the `check:raw-sql-inputs` gate (102 reviewed). | ACCEPTED until 2027-01-31; upgrade to ≥0.28.17 together with the Nest 11 batch (API surface change across ~700 query files) |
| @nestjs/core 10.4.22 — GHSA-36xv-jgw5-4q75; file-type 20.4.1 (ASF loop, ZIP bomb) | moderate | production | file-type is used on uploads behind authentication and the upload size cap | Nest 10 → 11.1.18+ (brings file-type 21.3.2+) — NEXT_STEPS |
| vitest 1.6.1 / 2.1.9 (tinypool) | critical | dev only | exploitable only with an exposed Vitest UI / API server; never run with `--ui` / `--api` here or in CI | vitest 4+ / 5 major — NEXT_STEPS |
| vite 5.4.21 dev server | high | dev only | dev server only (path traversal in optimized deps, Windows `fs.deny` bypass); production ships static builds | vite 6.4.4+ major — NEXT_STEPS |

## 4. Supply-chain controls (state after this batch)

| Control | State | Evidence |
|---|---|---|
| Hidden code / obfuscation / install hooks / root-script runners / tracked key material | gate in ci:gates | `check:supply-chain-injection`, `tooling/security/check-hidden-code.py` |
| Lockfile integrity | every entry resolved from registry.npmjs.org; nested stale entries removed | `npm ls` → 0 invalid / missing |
| SCA on every change | `npm run security:deps` in the fast lane; `dependency-review` job on PRs; Dependabot (npm, github-actions, gradle, docker) | .github/workflows/security.yml, .github/dependabot.yml |
| SAST | CodeQL javascript-typescript, security-extended | .github/workflows/codeql.yml (first run happens on GitHub — NOT_TESTED here) |
| Secret scanning | working tree regex (security:fast) + gitleaks on changed commits (gating) + full history (report-only until the K-12 history rewrite) | security.yml `secrets` job |
| Actions pinned | every `uses:` pinned to a full commit SHA (resolved Oct 23 2026) | .github/workflows/*.yml |
| Gradle | wrapper jar verified equal to the official Gradle 8.14.3 checksum; distribution checksum pinned; CI wrapper validation | `tooling/security/check-gradle-wrapper.mjs` (ci:gates), mobile.yml |
| Container | Trivy (critical-with-fix gate), image SBOM + provenance on publish, non-root | build-image.yml |
| Base image digests | tag-pinned only | REQUIRES KEVIN (pin `node:22-slim@sha256:…`) |
| Single-maintainer native plugin with token access (capacitor-secure-storage-plugin ^0.13.0) | accepted; review diffs on update | NEXT_STEPS |

## 5. SBOM

| File | Contents |
|---|---|
| [sbom/aipowersalon-production.cdx.json](sbom/aipowersalon-production.cdx.json) | CycloneDX 1.5, production dependencies of the whole workspace — 504 components, 447 with hashes from lock integrity (`npm sbom --sbom-format cyclonedx --omit dev --package-lock-only`) |
| [sbom/aipowersalon-mobile-native.json](sbom/aipowersalon-mobile-native.json) | Gradle (Android) toolchain + declared app / plugin coordinates, Swift Package Manager pins, container base images — declared versions (Maven transitive resolution needs the Android SDK, not present in the sandbox) |
| image SBOM | generated by CI on every image build (Trivy CycloneDX artifact) |

Licences (from the morning SBOM): MIT 810, Apache-2.0 122, ISC 48, BSD-3 20, MPL-2.0 14, BlueOak 11, BSD-2 10; no GPL / AGPL-only component.

## 6. Commands

```
npm audit --omit=dev --json          # production
npm audit --json                     # whole workspace
npm audit fix                        # non-breaking only (no --force)
node tooling/security/check-npm-audit.mjs
node tooling/security/check-gradle-wrapper.mjs
npm ls <package> --all
npm sbom --sbom-format cyclonedx --omit dev --package-lock-only > docs/security/sbom/aipowersalon-production.cdx.json
git ls-remote https://github.com/<owner>/<action> refs/tags/<tag>   # action SHA pins
curl https://services.gradle.org/distributions/gradle-8.14.3-{all.zip,wrapper.jar}.sha256
```
