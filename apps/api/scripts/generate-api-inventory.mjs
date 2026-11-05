#!/usr/bin/env node
// generate-api-inventory.mjs — §40 of the developer-handoff spec: the API inventory GENERATED from actual
// controllers, never hand-written. Re-run any time: node scripts/generate-api-inventory.mjs > ../../API_INVENTORY.md
//
// BUILD_PLAN Phase 15 (Oct 10 2026): the routes now come from the SAME extractor as the OpenAPI manifest
// (`audit-routes.js` + `openapi.mjs` factsOf — the enforcing guards, the effective permission key, realm, domain).
// The old version read only `apps/api/src/**/*.controller.ts`; since Constitution 13 most controllers live in
// `modules/*/src`, so it under-counted. Needs the packages built (`npm run build:packages`), like `check:openapi`.
import { createRequire } from 'node:module';
import process from 'node:process';
import { factsOf } from './openapi.mjs';

const require = createRequire(import.meta.url);
const { routes } = require('./audit-routes.js');

const rows = routes.map((r) => {
  const f = factsOf(r);
  const perm = f.perms.length ? f.perms.join(' \\| ') : f.derived ? `${f.derived} (derived)` : '';
  const tenantScope = f.realm === 'super_admin' ? 'Multi-Tenant' :
    f.realm === 'public' ? 'Public' :
    f.realm === 'customer' ? 'Customer' :
    (r.path.includes('/branches/') || r.path.includes('/branch/') || r.path.includes(':branchId')) ? 'Branch' : 'Tenant';
  const service = r.file.split('/').slice(-1)[0].replace(/\.controller\.ts$/, '').replace(/\.ts$/, '');
  const status = 'Active / Verified';
  return { method: r.method, path: f.key.slice(r.method.length + 1), perm, auth: f.auth, realm: f.realm, scope: tenantScope,
    domain: f.domain ?? 'NONE', service, guards: f.guards.join(' + '), file: r.file, status };
});
rows.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
const byMount = new Map();
for (const r of rows) { const mount = r.path.split('/')[1] || '(root)'; byMount.set(mount, (byMount.get(mount) ?? 0) + 1); }
const files = new Set(rows.map((r) => r.file));
const pub = rows.filter((r) => r.auth === 'public').length;
const unkeyed = rows.filter((r) => r.auth === 'session' && !r.perm).length;

const today = new Date().toISOString().slice(0, 10);
let out = `# API_INVENTORY.md\n\n`;
out += `**GENERATED FROM CODE — do not hand-edit.** Regenerate with:\n\`cd apps/api && node scripts/generate-api-inventory.mjs > ../../API_INVENTORY.md\`\n\n`;
out += `Generated ${today}. Source of truth: the route extractor behind the OpenAPI manifest (\`apps/api/scripts/audit-routes.js\` + \`openapi.mjs\`), which reads every controller under \`apps/api/src\` and \`modules/*/src\`. The reviewed, gate-checked form of the same list is \`apps/api/openapi/manifest.txt\` (\`check:openapi\`).\n\n`;
const unkeyedMounts = [...rows.filter((r) => r.auth === 'session' && !r.perm).reduce((m, r) => m.set('/' + r.path.split('/')[1], (m.get('/' + r.path.split('/')[1]) ?? 0) + 1), new Map())]
  .sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m} ${n}`).join(', ');
out += `- **Controller files:** ${files.size}\n- **Routes:** ${rows.length} (public: ${pub}; signed-in routes with no permission key: ${unkeyed} — ${unkeyedMounts}; customer and self-service routes scoped to the caller's own session, integration routes, and handlers that check a permission themselves (e.g. \`/ai/dashboard/settings\` requires \`ai.settings.manage\` in the handler). Staff routes without a key are frozen in \`apps/api/openapi/api-contract.unkeyed.baseline.txt\` by \`check:api-contract\`, which may only shrink)\n`;
out += `- **Authentication:** every non-public route passes the global session middleware (server-derived ctx); the enforcing guards are listed per route; \`/super-admin\` routes without a declared key get a key derived from their path domain (PlatformDomainGuard), shown as "(derived)".\n`;
out += `- **Tenant scope:** \`tenant/*\` and POS/app mounts derive tenantId/branchId SERVER-SIDE from the session — never from the client. Cross-tenant aggregation exists only in reviewed super-admin services (see the tenant-isolation gate's baseline in \`apps/api/scripts/tenant-isolation-check.mjs\`).\n`;
out += `- **Wiring status:** the \`check:crosswire\` gate proves every frontend call has a matching route and flags orphans; routes with no static frontend caller are catalogued in \`UNUSED_ROUTE_INVENTORY.md\` (wire-or-document, never delete).\n\n`;
out += `## Routes per mount\n\n| Mount | Routes |\n| --- | ---: |\n`;
for (const [m, n] of [...byMount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) out += `| /${m} | ${n} |\n`;
out += `\n## Full route table\n\n| Method | Route | Auth | Realm | Scope | Permission | Domain | Service | Guards | Controller | Status |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n`;
for (const r of rows) out += `| ${r.method} | \`${r.path}\` | ${r.auth} | ${r.realm} | ${r.scope} | ${r.perm || '—'} | ${r.domain} | ${r.service} | ${r.guards || '—'} | ${r.file} | ${r.status} |\n`;
process.stdout.write(out);
