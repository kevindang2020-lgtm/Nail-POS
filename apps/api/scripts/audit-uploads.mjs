#!/usr/bin/env node
// audit-uploads.mjs — BUILD_PLAN Phase 12 / Constitution 5 §158–§166 (API_DEFINITION_OF_DONE #34): every upload goes through
// the ONE upload policy (@aipowersalon/media upload-policy.ts).
//
// Inventory (--json prints it):
//   * multipart routes — every handler with an @UploadedFile(s) parameter (scripts/audit-routes.js, the one route collector);
//   * body / presigned upload routes — JSON_UPLOAD_ROUTES below (data: URLs, base64 bodies, presigned PUT requests), each
//     checked to still exist;
//   * store sites — every `.put(` on a media / blob store and every `presignPut(` call in apps/api/src and modules.
// The gate (check:uploads):
//   I1  every Multer interceptor takes its size limit from a policy (`UPLOAD_POLICIES.<name>.maxBytes`) — no ad-hoc caps;
//   S1  every file with a store site runs acceptUpload / checkDeclaredUpload with a named policy — or is reviewed in
//       tooling/ci/uploads.allowlist.json (an adapter whose caller ran the policy, a server-generated file) with a reason;
//   K1  every store-site file builds its key with a server-side key helper (uploadObjectKey or a named tenant-scoped one);
//   R1  every multipart route's handler file — or the service file it delegates to (DELEGATES) — runs the policy;
//   J1  every JSON_UPLOAD_ROUTES entry exists in the route table and its implementing file runs the policy;
//   N1  no allowlist entry is stale (it must still match a store site).
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const API = resolve(new URL('..', import.meta.url).pathname);
const ROOT = resolve(API, '..', '..');
const ALLOWLIST = join(ROOT, 'tooling/ci/uploads.allowlist.json');
const require = createRequire(import.meta.url);

/** Upload routes that do not use multipart: route → the file that runs the policy for it. */
export const JSON_UPLOAD_ROUTES = {
  'PATCH /pos/me/avatar': 'apps/api/src/profile/profile.service.ts',
  'POST /pos/settings/receipts-branding/logo': 'modules/tenants/src/settings/settings.service.ts',
  'POST /tenant/help/tickets/:id/attachments': 'modules/support/src/help/support-attachments.service.ts',
  'POST /pos/ai-ocr-receipt/upload': 'modules/safety/src/ai-ocr-receipt/ai-ocr-receipt.service.ts',
  'POST /community/evidence/uploads': 'modules/safety/src/tenant-safety-community/community-interactions.service.ts',
};
/** Routes that take file metadata or refuse uploads — inventoried, not storage uploads (the reason is reported). */
export const NOT_STORED_UPLOAD_ROUTES = {
  'POST /super-admin/disputes/:id/evidence': 'metadata only — the bytes are not stored (storageRef is a reference); validateUpload + modeledScan in evidence-policy-core.ts. FINDING: the modeled scan answers clean when no content is sent',
  'POST /super-admin/settings/branding/logo': 'the platform logo is a locked brand asset — the route always refuses (423 / 501)',
};
/** A multipart controller whose handler hands the buffer to a service that runs the policy. */
export const DELEGATES = {
  'modules/workforce/src/tech-profile/tech-profile.controller.ts': 'modules/workforce/src/tech-profile/tech-profile.service.ts',
  'modules/marketing/src/display-advertising/display-ads.controller.ts': 'modules/marketing/src/display-advertising/display-ads.service.ts',
  'modules/marketing/src/display-advertising/platform-advertising.controller.ts': 'modules/marketing/src/display-advertising/platform-advertising.ts',   // G7 platform campaign images
};
const KEY_HELPERS = /\b(uploadObjectKey|salonLogoKey|attachmentStorageKey|storageKeyFor|evidenceStorageKey|adMediaKeys)\s*\(/;
const RUNS_POLICY = /\b(acceptUpload|checkDeclaredUpload)\s*\(\s*(\{\s*\.\.\.\s*)?UPLOAD_POLICIES\.\w+|\b(acceptUpload|checkDeclaredUpload)\s*\(\s*policy\b/;
const STORE_PUT = /\b(?:storage|store\(\)|media|blobs|getStorage\(\)|makeMediaStorage\(\)|this\.blob)\.(put|presignPut!?)\(/g;
const INTERCEPTOR = /\b(FileInterceptor|FilesInterceptor|FileFieldsInterceptor)\(/g;

function* walk(d) {
  for (const n of readdirSync(d)) {
    if (n === 'node_modules' || n === 'dist' || n.startsWith('.')) continue;
    const p = join(d, n); const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (p.endsWith('.ts') && !/\.(spec|test)\.ts$|vitest|pgtest|\.d\.ts$/.test(p)) yield p;
  }
}
const lineOf = (src, i) => src.slice(0, i).split('\n').length;
/** The text of a call starting at `(` — parentheses balanced. */
const callText = (src, open) => { let d = 0; for (let k = open; k < src.length; k++) { if (src[k] === '(') d++; else if (src[k] === ')' && --d === 0) return src.slice(open, k + 1); } return src.slice(open); };

export function inventory() {
  const files = [];
  for (const root of [join(ROOT, 'apps/api/src'), join(ROOT, 'modules')]) for (const f of walk(root)) files.push(f);
  const storeSites = [], interceptors = [];
  const srcOf = new Map();
  for (const f of files) {
    const src = readFileSync(f, 'utf8'); const rel = f.replace(ROOT + '/', '');
    srcOf.set(rel, src);
    const code = src.replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));   // comments do not count (offsets kept)
    for (const m of code.matchAll(STORE_PUT)) storeSites.push({ file: rel, line: lineOf(code, m.index), call: m[1].replace('!', '') });
    for (const m of code.matchAll(INTERCEPTOR)) {
      if (/import\s*\{[^}]*$/.test(code.slice(Math.max(0, m.index - 200), m.index))) continue;   // the import list
      interceptors.push({ file: rel, line: lineOf(code, m.index), kind: m[1], text: callText(code, m.index + m[0].length - 1) });
    }
  }
  const { routes } = require(join(API, 'scripts/audit-routes.js'));
  const multipart = routes.filter((r) => r.params?.some((x) => x.in === 'UploadedFile' || x.in === 'UploadedFiles'))
    .map((r) => ({ route: `${r.method} ${r.path}`, file: r.file.startsWith('modules/') ? r.file : `apps/api/src/${r.file}`, handler: r.handler }));
  const routeKeys = new Set(routes.map((r) => `${r.method} ${r.path}`));
  return { storeSites, interceptors, multipart, routeKeys, srcOf };
}

export function check(inv = inventory(), allow = existsSync(ALLOWLIST) ? JSON.parse(readFileSync(ALLOWLIST, 'utf8')) : { storeSites: {} }) {
  const findings = [];
  const read = (rel) => inv.srcOf.get(rel) ?? (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : '');
  const reviewed = allow.storeSites ?? {};
  for (const i of inv.interceptors) if (!/fileSize:\s*(Math\.min\([^)]*)?UPLOAD_POLICIES\.\w+\.maxBytes/.test(i.text)) findings.push(`I1  ${i.file}:${i.line}  ${i.kind} size limit is not a policy's (use UPLOAD_POLICIES.<name>.maxBytes)`);
  const siteFiles = [...new Set(inv.storeSites.map((s) => s.file))];
  for (const f of siteFiles) {
    if (reviewed[f]) continue;
    const src = read(f);
    if (!RUNS_POLICY.test(src)) findings.push(`S1  ${f}  stores uploaded bytes without acceptUpload / checkDeclaredUpload(UPLOAD_POLICIES.<name>, …)`);
    if (!KEY_HELPERS.test(src)) findings.push(`K1  ${f}  builds a storage key without a server-side key helper (uploadObjectKey)`);
  }
  for (const r of inv.multipart) {
    const own = read(r.file); const del = DELEGATES[r.file] ? read(DELEGATES[r.file]) : '';
    if (!RUNS_POLICY.test(own) && !RUNS_POLICY.test(del)) findings.push(`R1  ${r.route}  (${r.file}) — the multipart upload never reaches the upload policy`);
  }
  for (const [route, file] of Object.entries(JSON_UPLOAD_ROUTES)) {
    if (!inv.routeKeys.has(route)) findings.push(`J1  ${route}  is listed as a body upload route but no longer exists — update JSON_UPLOAD_ROUTES`);
    else if (!RUNS_POLICY.test(read(file))) findings.push(`J1  ${route}  (${file}) does not run the upload policy`);
  }
  for (const f of Object.keys(reviewed)) if (!siteFiles.includes(f)) findings.push(`N1  allowlist entry '${f}' matches no store site — remove it`);
  const onPolicy = inv.multipart.filter((r) => RUNS_POLICY.test(read(r.file)) || (DELEGATES[r.file] && RUNS_POLICY.test(read(DELEGATES[r.file])))).length
    + Object.entries(JSON_UPLOAD_ROUTES).filter(([route, file]) => inv.routeKeys.has(route) && RUNS_POLICY.test(read(file))).length;
  const total = inv.multipart.length + Object.keys(JSON_UPLOAD_ROUTES).length;
  return { findings, onPolicy, total, siteFiles, reviewed: Object.keys(reviewed).length };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const inv = inventory();
  const r = check(inv);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ multipart: inv.multipart, jsonRoutes: JSON_UPLOAD_ROUTES, notStored: NOT_STORED_UPLOAD_ROUTES, storeSites: inv.storeSites, interceptors: inv.interceptors.map(({ text, ...x }) => x), ...r }, null, 2)); await new Promise((r) => process.stdout.write('', r)); process.exit(0);
  }
  for (const f of r.findings) console.log(f);
  console.log(`uploads: ${r.onPolicy}/${r.total} upload routes on the upload policy (${inv.multipart.length} multipart + ${Object.keys(JSON_UPLOAD_ROUTES).length} body / presigned; ${Object.keys(NOT_STORED_UPLOAD_ROUTES).length} more store no bytes); ${inv.interceptors.length} interceptors; ${inv.storeSites.length} store sites in ${r.siteFiles.length} files (${r.reviewed} reviewed adapters); ${r.findings.length} findings`);
  process.exit(r.findings.length ? 1 : 0);
}
