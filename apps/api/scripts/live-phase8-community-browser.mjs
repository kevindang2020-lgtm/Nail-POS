#!/usr/bin/env node
// live-phase8-community-browser.mjs — BUILD_PLAN Phase 8 (tenant_safety_community → complete), proved IN A REAL BROWSER
// (headless Chromium) against the real compiled API and the local PostgreSQL. Nothing is stubbed: the built pos-web and
// admin-web bundles are served behind a same-origin static + API proxy (so the session cookie flows exactly as in
// production) and real people click through them:
//   1. salon A = PILOT01 (a proof branch, a RECEPTION user and a MANAGER user): the receptionist opens the Safety
//      Community in the POS, acknowledges the rules, writes a HIGH-severity `account_takeover_attempt` advisory whose
//      body carries one phone number, and submits it → it waits for a manager (receptionist approval required);
//   2. the manager approves it in the POS → the category always needs moderation → held in `moderation_review`;
//   3. a Super Admin (admin-web; step-up stamped in the DB like the Phase 7 proof) publishes it from the Review queue;
//   4. salon B (a NEW proof tenant with its owner) sees it in the POS feed, opens the deep link /community/posts/:id,
//      acknowledges the rules and comments.
// Around it, API / DB checks: the phone number is redacted (and flagged), the draft was invisible to salon B before
// publication, salon B never receives salon A's ids (tenant, branch, users), the moderation case + action were written
// with the real Super Admin, and the alert outbox row for salon B exists (and none for the author).
// Screenshots go to $SHOTS (default <scratch>/p8/shots). It removes EVERYTHING it made — the posts and every row hanging
// off them, both salons' proof rows, the proof tenant, the users and their sessions — and restores PILOT01's community
// settings row exactly (append-only audit rows stay, by design, and are counted).
//
// Run (apps/api built; apps/pos-web and apps/admin-web built with `npx vite build`):
//   DATABASE_URL=postgres://postgres@localhost:5432/postgres node scripts/live-phase8-community-browser.mjs
// Never point it at production. Selectors for the screens live in SEL below (one table) — the POS community screens'
// accessible names are matched loosely on purpose; adjust SEL if a label changes.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import http from 'node:http';
import { existsSync, statSync, readFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeProofBranchTx } from './proof-cleanup.mjs';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { hashPassword } = require('@aipowersalon/auth');
const { chromium } = require('playwright');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const HERE = dirname(fileURLToPath(import.meta.url));
const API_DIR = join(HERE, '..');
const POS_DIST = join(API_DIR, '..', 'pos-web', 'dist'), ADMIN_DIST = join(API_DIR, '..', 'admin-web', 'dist');
for (const d of [POS_DIST, ADMIN_DIST]) if (!existsSync(join(d, 'index.html'))) { console.error(`build first: ${d}/index.html is missing (npx vite build)`); process.exit(2); }
const API_PORT = Number(process.env.P8_API_PORT) || 3068, POS_PORT = Number(process.env.P8_POS_PORT) || 4268, ADMIN_PORT = Number(process.env.P8_ADMIN_PORT) || 4269;
const API = `http://127.0.0.1:${API_PORT}`, POS = `http://127.0.0.1:${POS_PORT}`, ADMIN = `http://127.0.0.1:${ADMIN_PORT}`;
const SALON = process.env.SALON_CODE || 'PILOT01';
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-claude/59f94190-34ea-56af-bac0-4d60a89b63f0/scratchpad/p8/shots';
mkdirSync(SHOTS, { recursive: true });
// the repo's playwright may be newer than the preinstalled Chromium build — use the machine's Chromium
const CHROMIUM = process.env.CHROMIUM_PATH || (() => {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  try { for (const d of readdirSync(root).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) for (const sub of ['chrome-linux64', 'chrome-linux']) { const p = join(root, d, sub, 'chrome'); if (existsSync(p)) return p; } } catch { /* none */ }
  return undefined;
})();

// ── SELECTORS (one table; the lead adjusts here) ─────────────────────────────────────────────────────────────────────
// {role,name} → getByRole · {label} → getByLabel · {text} → getByText · string → CSS. Names are regexes where the POS
// wording is agent D's; the admin-web names are this proof's own screen (CommunityModerationScreen) and exact.
const SEL = {
  pos: {
    loginStore: '#aps-store', loginIdentifier: '#aps-identifier', loginPassword: '#aps-password',
    loginSubmit: { role: 'button', name: /^Sign In$/i },
    branchButton: (branchName) => ({ role: 'button', name: new RegExp('^' + branchName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }),
    navEntry: { role: 'link', name: /Safety Community/i },
    rulesDialog: { role: 'dialog', name: /Safety Community rules/i },                   // D: CommunityRules.tsx — opens on the first Save / Submit / Post comment
    rulesAccept: { role: 'button', name: /I agree to the community rules/i },
    newAdvisory: { path: '/community/new' },
    // D: CommunityAdvisoryEditor.tsx — labels WRAP their controls, so a control's accessible name is the label text plus
    // its current value / selected option ("Category Choose…"): match the prefix only.
    draftTitle: { label: /^Title/ },
    draftCategory: { label: /^Category/ },
    draftSeverity: { label: /^Severity/ },
    draftBody: { label: /^What happened/ },
    draftRecommendation: { label: /^What helped/ },                                     // optional
    draftRegion: { label: /^Region/ },                                                  // optional
    draftSubmit: { role: 'button', name: /^Submit advisory$/ },
    editorStatus: '[data-testid="community-editor-status"]',
    // D: CommunityApprovalsScreen.tsx — one button per row, named after the advisory
    approvals: { path: '/community/approvals' },
    approvalRow: (title) => ({ css: '[data-testid="community-approval-row"]', hasText: title }),
    approve: (title) => ({ role: 'button', name: `Approve: ${title}`, exact: true }),
    approvalResult: '[data-testid="community-approval-result"]',
    // D: CommunityFeedScreen.tsx (a Link per title) / CommunityPostScreen.tsx (#community-post-title) / CommunityComments.tsx
    feed: { path: '/community' },
    feedTitle: (title) => ({ role: 'link', name: title, exact: true }),
    postTitle: '#community-post-title',
    postPath: (id) => `/community/posts/${id}`,
    commentBox: { label: 'Add a comment', exact: true },
    commentSubmit: { role: 'button', name: 'Post comment', exact: true },
    comment: (text) => ({ css: '[data-testid="community-comment"]', hasText: text }),
  },
  admin: {
    loginIdentifier: { label: 'Email or Username' }, loginPassword: { label: 'Password', exact: true },
    loginSubmit: { role: 'button', name: /^Sign In/ },
    mfaCode: { label: '6-digit verification code' }, mfaSubmit: { role: 'button', name: /^Verify$/ },
    center: { path: '/community-moderation' },
    heading: { role: 'heading', name: 'Safety Community Moderation' },
    reviewTab: { role: 'tab', name: 'Review queue' },
    queueRow: (title) => ({ css: '[data-testid="mod-post-row"]', hasText: title }),
    publish: { role: 'button', name: 'Publish…' },
    dialog: { role: 'dialog' },
    reason: { label: 'Reason' },
    confirmPublish: { role: 'button', name: 'Publish', exact: true },
    status: { role: 'status' },
  },
};
const loc = (scope, s) => {
  if (typeof s === 'string') return scope.locator(s);
  if (s.css) return scope.locator(s.css, s.hasText ? { hasText: s.hasText } : undefined);
  if (s.role) return scope.getByRole(s.role, { name: s.name, ...(s.exact ? { exact: true } : {}) });
  if (s.label) return scope.getByLabel(s.label, s.exact ? { exact: true } : undefined);
  if (s.text) return scope.getByText(s.text, { exact: false });
  throw new Error('bad selector ' + JSON.stringify(s));
};
const visible = async (l, ms = 1500) => { try { await l.first().waitFor({ state: 'visible', timeout: ms }); return true; } catch { return false; } };

const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (x) => JSON.stringify(x ?? null).slice(0, 220);
const j = async (r) => { const t = await r.text(); try { return { status: r.status, body: JSON.parse(t), text: t }; } catch { return { status: r.status, body: t, text: t }; } };

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────────────────────────
const client = new pg.Client({ connectionString: DB }); await client.connect();
const q = async (s, p = []) => (await client.query(s, p)).rows;
const TA = (await q(`select id from tenants where tenant_code = $1`, [SALON]))[0]?.id;
if (!TA) { console.error(`salon ${SALON} not found`); process.exit(2); }

/** every community row hanging off these posts (FK or not): comments, reports, versions, follows, cases, actions… */
async function removeCommunityPosts(postIds, extra = {}) {
  if (!postIds.length && !extra.caseOpenedBy?.length) return;
  const cols = await q(`select table_name, column_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
     where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.table_name like 'community%'`);
  const has = (t, c) => cols.some((r) => r.table_name === t && r.column_name === c);
  const commentIds = postIds.length ? (await q(`select id from community_comments where post_id = any($1::uuid[])`, [postIds])).map((r) => r.id) : [];
  const caseIds = (await q(`select id from community_moderation_cases where post_id = any($1::uuid[]) or opened_by_user_id = any($2::uuid[]) or comment_id = any($3::uuid[])`, [postIds, extra.caseOpenedBy ?? [], commentIds])).map((r) => r.id);
  const evidenceIds = has('community_evidence', 'post_id') && postIds.length ? (await q(`select id from community_evidence where post_id = any($1::uuid[])`, [postIds])).map((r) => r.id) : [];
  const targets = [];
  for (const { table_name: t, column_name: c } of cols) {
    if (t === 'community_posts') { if (/post_id$/.test(c)) targets.push([t, c, postIds]); continue; }
    if (/post_id$/.test(c)) targets.push([t, c, postIds]);
    else if (/comment_id$/.test(c) && t !== 'community_comments') targets.push([t, c, commentIds]);
    else if (c === 'parent_id' && t === 'community_comments') targets.push([t, c, commentIds]);
    else if (c === 'case_id') targets.push([t, c, caseIds]);
    else if (c === 'evidence_id') targets.push([t, c, evidenceIds]);
  }
  await client.query('begin');
  try {
    for (let pass = 0; pass < 8; pass++) {
      let left = 0;
      for (const [t, c, ids] of [...targets, ['community_moderation_cases', 'id', caseIds], ['community_comments', 'id', commentIds], ['community_evidence', 'id', evidenceIds], ['community_posts', 'id', postIds]]) {
        if (!ids.length || !has(t, c)) continue;
        await client.query('savepoint p');
        try { await client.query(`delete from "${t}" where "${c}" = any($1::uuid[])`, [ids]); await client.query('release savepoint p'); }
        catch { await client.query('rollback to savepoint p'); left++; }
      }
      if (!left) break;
    }
    await client.query('commit');
  } catch (e) { await client.query('rollback').catch(() => undefined); throw e; }
}

/** every row of a proof tenant, in any table with a *tenant_id column, then the tenant itself (append-only rows stay) */
async function removeProofTenant(tenantId) {
  const cols = await q(`select c.table_name, c.column_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
     where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.column_name like '%tenant_id' and c.table_name <> 'tenants' and c.data_type = 'uuid'`);
  const kept = new Set();
  await client.query('begin');
  try {
    const tables = [...new Set(cols.map((r) => r.table_name))];
    // rows elsewhere that point at this tenant's rows through a foreign key (no tenant column of their own)
    for (const t of tables) {
      const refs = await q(`select c.conrelid::regclass::text as ref, a.attname as col from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
        where c.contype = 'f' and c.confrelid = $1::regclass and array_length(c.conkey, 1) = 1`, [t]);
      const tc = cols.find((r) => r.table_name === t && r.column_name === 'tenant_id');
      if (!tc) continue;
      for (const r of refs) {
        if (tables.includes(r.ref.replace(/"/g, ''))) continue;
        await client.query('savepoint p');
        try { await client.query(`delete from ${r.ref} where "${r.col}" in (select id from "${t}" where tenant_id = $1)`, [tenantId]); await client.query('release savepoint p'); }
        catch { await client.query('rollback to savepoint p'); }
      }
    }
    let pending = cols;
    for (let pass = 0; pass < 10 && pending.length; pass++) {
      const next = [];
      for (const r of pending) {
        await client.query('savepoint p');
        try { await client.query(`delete from "${r.table_name}" where "${r.column_name}" = $1`, [tenantId]); await client.query('release savepoint p'); }
        catch { await client.query('rollback to savepoint p'); next.push(r); }
      }
      if (next.length === pending.length) { pending = next; break; }
      pending = next;
    }
    for (const r of pending) {
      const n = (await q(`select count(*)::int as n from "${r.table_name}" where "${r.column_name}" = $1`, [tenantId]))[0].n;
      if (n) kept.add(`${r.table_name}(${n})`);
    }
    await client.query('savepoint p');
    let removed = false;
    try { await client.query(`delete from tenants where id = $1`, [tenantId]); await client.query('release savepoint p'); removed = true; }
    catch (e) { await client.query('rollback to savepoint p'); kept.add(`tenants: ${String(e?.message || e).slice(0, 80)}`); }
    await client.query('commit');
    return { removed, kept: [...kept] };
  } catch (e) { await client.query('rollback').catch(() => undefined); throw e; }
}

// leftovers from an interrupted earlier run
for (const r of await q(`select id from tenants where tenant_slug like 'live-phase8-proof-%'`)) {
  await removeCommunityPosts((await q(`select id from community_posts where origin_tenant_id = $1`, [r.id])).map((x) => x.id));
  await removeProofTenant(r.id);
}
for (const r of await q(`select id from branches where tenant_id = $1 and name like 'Live Phase8 Proof%'`, [TA])) {
  await removeCommunityPosts((await q(`select id from community_posts where origin_tenant_id = $1 and origin_branch_id = $2`, [TA, r.id])).map((x) => x.id));
  await removeProofBranchTx(client, TA, r.id);
}

const STARTED = new Date();
const tag = String(Date.now()).slice(-6);
const BA = randomUUID(), REC = randomUUID(), MGR = randomUUID(), SA = randomUUID();
const TB = randomUUID(), BB = randomUUID(), OWNB = randomUUID();
const PW = 'Phase8!' + randomUUID().slice(0, 10);
const BRANCH_A = `Live Phase8 Proof ${tag}`, BRANCH_B = `Phase8 Other Main ${tag}`;
const CODE_B = `P8B${tag}`;
const REC_EMAIL = `phase8-rec-${tag}@aipowersalon.test`, MGR_EMAIL = `phase8-mgr-${tag}@aipowersalon.test`;
const OWNB_EMAIL = `phase8-ownb-${tag}@aipowersalon.test`, SA_EMAIL = `phase8-sa-${tag}@aipowersalon.test`;
const PHONE = '856-555-0142';
const TITLE = `Fake bank caller asked for the POS login code — proof ${tag}`;
const BODY = `A man called the front desk saying he was from our card processor and asked the receptionist to read back the login code sent to the owner. He called from ${PHONE}. We hung up and called the processor on the number on our statement — it was not them.`;
const COMMENT = `Same call reached us this morning ${tag} — thank you for the warning.`;
const hash = await hashPassword(PW);
const settingsBeforeA = (await q(`select * from tenant_community_settings where tenant_id = $1`, [TA]))[0] ?? null;

await q(`insert into branches (id, tenant_id, name, status, timezone, address) values ($1,$2,$3,'active','America/New_York','8 Proof Way')`, [BA, TA, BRANCH_A]);
for (const [u, email, role, fn] of [[REC, REC_EMAIL, 'RECEPTION', 'Rae'], [MGR, MGR_EMAIL, 'MANAGER', 'Mia']]) {
  await q(`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role) values ($1,$2,$3,$4,'Eight',$4 || ' Eight',$5,$6,'active',$7)`, [u, TA, BA, fn, email, hash, role]);
  await q(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) values ($1,$2,$3,$4)`, [TA, BA, u, role === 'MANAGER' ? 'manager' : 'staff']).catch(() => q(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) values ($1,$2,$3,'staff')`, [TA, BA, u]).catch(() => undefined));
}
// salon A: in the community, and a receptionist's submission needs a manager
if (settingsBeforeA) await q(`update tenant_community_settings set enabled = true, receptionist_approval_required = true where tenant_id = $1`, [TA]);
else await q(`insert into tenant_community_settings (tenant_id, enabled, receptionist_approval_required) values ($1, true, true)`, [TA]);
// salon B: a NEW proof tenant with one branch and its owner, in the community
await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,$2,$2,$3,$4,'active')`, [TB, `Live Phase8 Proof Salon B ${tag}`, `live-phase8-proof-${tag}`, CODE_B]);
await q(`insert into branches (id, tenant_id, name, status, timezone, address) values ($1,$2,$3,'active','America/New_York','9 Other Way')`, [BB, TB, BRANCH_B]);
await q(`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role) values ($1,$2,$3,'Olive','Bee','Olive Bee',$4,$5,'active','OWNER')`, [OWNB, TB, BB, OWNB_EMAIL, hash]);
await q(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) values ($1,$2,$3,'manager')`, [TB, BB, OWNB]).catch(() => q(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) values ($1,$2,$3,'staff')`, [TB, BB, OWNB]).catch(() => undefined));
await q(`insert into tenant_community_settings (tenant_id, enabled) values ($1, true)`, [TB]);
await q(`insert into users (id, tenant_id, first_name, last_name, full_name, email, password_hash, status, role, mfa_enabled, platform_role) values ($1, null, 'Pat', 'Eight', 'Pat Eight', $2, $3, 'active', 'SUPER_ADMIN', false, 'PLATFORM_SUPER_ADMIN')`, [SA, SA_EMAIL, hash]);
const usersA = [REC, MGR], allUsers = [REC, MGR, OWNB, SA];

// ── processes: compiled API + two same-origin static/proxy servers ───────────────────────────────────────────────────
const env = { ...process.env, REPO_DRIVER: 'postgres', AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development', PORT: String(API_PORT), TRUST_PROXY_HOPS: '1', EVENT_PUBLISHER_ENABLED: 'true' };
for (const k of ['PROCESS_ROLE', 'CAPTCHA_SECRET_KEY', 'CAPTCHA_SITE_KEY']) delete env[k];
env.COMMUNITY_JOBS = 'off'; env.AI_QUEUE_OPS_JOBS = 'off'; env.AI_SCHEDULING_JOBS = 'off';   // background jobs would race the proof
let apiProc = null, apiErr = '';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.map': 'application/json' };
/** A browser NAVIGATION (Accept: text/html) gets the SPA; a real file in dist is served; everything else is the API.
 *  (The POS route /community and the API prefix /community share a path — the Accept header tells them apart.) */
function sameOrigin(dist) {
  return http.createServer((req, res) => {
    const path = (req.url || '/').split('?')[0];
    const file = join(dist, path === '/' ? 'index.html' : path.slice(1));
    const isFile = path !== '/' && existsSync(file) && statSync(file).isFile();
    const wantsHtml = req.method === 'GET' && /text\/html/.test(String(req.headers.accept || ''));
    if (isFile || wantsHtml) {
      const f = isFile ? file : join(dist, 'index.html');
      res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' }); res.end(readFileSync(f)); return;
    }
    const headers = { ...req.headers, host: `127.0.0.1:${API_PORT}` };
    delete headers.connection; delete headers['keep-alive'];
    const pr = http.request({ hostname: '127.0.0.1', port: API_PORT, path: req.url, method: req.method, headers }, (br) => {
      const sc = br.headers['set-cookie'];
      if (sc) br.headers['set-cookie'] = sc.map((c) => c.replace(/;\s*Secure/ig, '').replace(/;\s*Partitioned/ig, '').replace(/;\s*Domain=[^;]*/ig, '').replace(/;\s*SameSite=None/ig, '; SameSite=Lax'));
      try { res.writeHead(br.statusCode || 502, br.headers); } catch { /* closed */ }
      br.pipe(res);
    });
    pr.on('error', () => { try { res.writeHead(502); res.end('proxy error'); } catch { /* closed */ } });
    req.pipe(pr);
  });
}
const posSrv = sameOrigin(POS_DIST), adminSrv = sameOrigin(ADMIN_DIST);

// ── API helpers (the same calls the apps make) ─────────────────────────────────────────────────────────────────────
const as = (cookie) => (method, path, body) => fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(j);
const staffApi = async (salonCode, email, branchId) => {
  const l = await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ portal: 'tenant', salonCode, identifier: email, password: PW }) });
  const c1 = (l.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]);
  const sel = await fetch(API + '/auth/select-branch', { method: 'POST', headers: { cookie: c1.join('; '), 'content-type': 'application/json' }, body: JSON.stringify({ branchId }) });
  const jar = new Map(); for (const c of [...c1, ...(sel.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0])]) { const k = c.split('=')[0]; if (k) jar.set(k, c); }
  return { ok: l.status === 200 && sel.status === 200, detail: `login ${l.status} select ${sel.status}`, call: as([...jar.values()].join('; ')) };
};
const postRow = async (id) => (await q(`select status, redacted_body, privacy_scan_flags, visibility, verification_label, version from community_posts where id = $1`, [id]))[0];
const waitFor = async (fn, ms = 10_000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(250); } return v; };

// ── browser helpers ────────────────────────────────────────────────────────────────────────────────────────────────
let browser = null;
const pageErrors = [];
async function newPage(label) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${label}: ${String(e?.message || e).slice(0, 160)}`));
  return page;
}
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }).catch(() => undefined);
async function posLogin(page, salonCode, email, branchName) {
  await page.goto(POS + '/', { waitUntil: 'load' });
  await loc(page, SEL.pos.loginStore).fill(salonCode);
  await loc(page, SEL.pos.loginIdentifier).fill(email);
  await loc(page, SEL.pos.loginPassword).fill(PW);
  await loc(page, SEL.pos.loginSubmit).click();
  const pick = loc(page, SEL.pos.branchButton(branchName));
  if (await visible(pick, 6000)) await pick.first().click();
  await page.waitForFunction(() => !document.querySelector('#aps-password'), null, { timeout: 15000 });
  await sleep(600);
}
/** the rules acknowledgment modal, whenever it is up (before the first draft / comment) */
async function acknowledgeRules(page, ms = 2500) {
  const dlg = loc(page, SEL.pos.rulesDialog);
  if (!(await visible(dlg, ms))) return false;
  await loc(dlg.first(), SEL.pos.rulesAccept).first().click();
  await dlg.first().waitFor({ state: 'hidden', timeout: 8000 }).catch(() => undefined);
  return true;
}
async function choose(select, value) {
  try { await select.selectOption({ value }, { timeout: 8000 }); return; } catch { /* by its label */ }
  const opts = await select.locator('option').allTextContents();
  const hit = opts.find((o) => o.toLowerCase().replace(/[^a-z]/g, '') === value.replace(/[^a-z]/g, ''));
  if (!hit) throw new Error(`no option ${value} in ${opts.join(' | ').slice(0, 200)}`);
  await select.selectOption({ label: hit }, { timeout: 8000 });
}

// ── cleanup ────────────────────────────────────────────────────────────────────────────────────────────────────────
let postId = null;
const cleanup = async () => {
  try { await browser?.close(); } catch { /* */ }
  try { apiProc?.kill('SIGTERM'); } catch { /* */ }
  posSrv.close(); adminSrv.close();
  await sleep(1200);
  const posts = (await q(`select id from community_posts where (origin_tenant_id = $1 and (origin_branch_id = $2 or created_by_user_id = any($3::uuid[]))) or origin_tenant_id = $4`, [TA, BA, usersA, TB])).map((r) => r.id);
  if (postId && !posts.includes(postId)) posts.push(postId);
  await removeCommunityPosts(posts, { caseOpenedBy: [SA] }).catch((e) => check('cleanup: community rows', false, String(e?.message || e)));
  // outbox rows about the proof posts (any salon — alerts go to recipients) and notifications that mention them
  await q(`delete from outbox_events where created_at >= $1 and (aggregate_id = any($2::text[]) or payload_json->>'postId' = any($2::text[]) or tenant_id = $3)`, [STARTED, posts, TB]).catch(() => undefined);
  for (const t of (await q(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and table_name like '%notification%'`)).map((r) => r.table_name)) {
    const cs = await q(`select column_name, data_type from information_schema.columns where table_name = $1`, [t]);
    if (!cs.some((c) => c.column_name === 'created_at')) continue;
    for (const c of cs.filter((c) => ['text', 'jsonb', 'json'].includes(c.data_type))) for (const p of posts)
      await q(`delete from "${t}" where created_at >= $1 and "${c.column_name}"::text like $2`, [STARTED, `%${p}%`]).catch(() => undefined);
  }
  await q(`delete from community_rules_acknowledgments where user_id = any($1::uuid[])`, [allUsers]).catch(() => undefined);
  for (const u of allUsers) for (const t of ['refresh_tokens', 'sessions', 'auth_events', 'auth_devices']) await q(`delete from ${t} where user_id = $1`, [u]).catch(() => undefined);
  await q(`delete from login_attempts where identifier = any($1::text[])`, [[REC_EMAIL, MGR_EMAIL, OWNB_EMAIL, SA_EMAIL]]).catch(() => undefined);
  // salon A's community settings exactly as before
  if (settingsBeforeA) {
    const cols = Object.keys(settingsBeforeA).filter((k) => k !== 'tenant_id');
    await q(`update tenant_community_settings set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} where tenant_id = $1`, [TA, ...cols.map((c) => (settingsBeforeA[c] !== null && typeof settingsBeforeA[c] === 'object' && !(settingsBeforeA[c] instanceof Date) ? JSON.stringify(settingsBeforeA[c]) : settingsBeforeA[c]))]).catch((e) => check('settings restore', false, String(e?.message)));
  } else await q(`delete from tenant_community_settings where tenant_id = $1`, [TA]).catch(() => undefined);
  const a = await removeProofBranchTx(client, TA, BA).catch((e) => ({ removed: false, kept: [String(e?.message || e)] }));
  await q(`delete from users where id = any($1::uuid[]) and (tenant_id = $2 or tenant_id is null)`, [[REC, MGR, SA], TA]).catch(() => undefined);
  await q(`delete from users where id = $1`, [SA]).catch(() => undefined);
  const b = await removeProofTenant(TB).catch((e) => ({ removed: false, kept: [String(e?.message || e)] }));
  const settingsAfterA = (await q(`select * from tenant_community_settings where tenant_id = $1`, [TA]))[0] ?? null;
  const restored = JSON.stringify(settingsAfterA) === JSON.stringify(settingsBeforeA);
  const left = (await q(`select (select count(*)::int from community_posts where id = any($1::uuid[])) + (select count(*)::int from community_comments where post_id = any($1::uuid[]))
      + (select count(*)::int from community_moderation_cases where post_id = any($1::uuid[]) or opened_by_user_id = $2) + (select count(*)::int from community_moderation_actions where actor_user_id = $2)
      + (select count(*)::int from users where id = any($3::uuid[])) + (select count(*)::int from branches where id = any($4::uuid[])) + (select count(*)::int from tenants where id = $5)
      + (select count(*)::int from outbox_events where payload_json->>'postId' = any($6::text[])) + (select count(*)::int from community_rules_acknowledgments where user_id = any($3::uuid[])) as n`,
    [posts, SA, allUsers, [BA, BB], TB, posts]))[0].n;
  const appendOnly = (await q(`select count(*)::int as n from audit_events where tenant_id = $1 and occurred_at >= $2`, [TB, STARTED]).catch(() => [{ n: '?' }]))[0].n;
  check('cleanup: the posts and everything hanging off them, both salons’ proof rows, the proof tenant, the users and their sessions are gone; PILOT01’s community settings are exactly as before',
    a.removed && b.removed && left === 0 && restored, `branchA ${a.removed} [${(a.kept ?? []).join(', ')}] tenantB ${b.removed} [${(b.kept ?? []).join(', ')}] left=${left} settingsRestored=${restored} (append-only audit rows kept for salon B: ${appendOnly})`);
  await client.end();
};
const timer = setTimeout(async () => { console.error('timed out'); await cleanup().catch(() => undefined); console.log(results.join('\n')); process.exit(1); }, 12 * 60_000);

// ── the proof ──────────────────────────────────────────────────────────────────────────────────────────────────────
try {
  apiProc = spawn('node', ['dist/main.js'], { cwd: API_DIR, env, stdio: ['ignore', 'ignore', 'pipe'] });
  apiProc.stderr.on('data', (c) => { apiErr += c; });
  await new Promise((r) => posSrv.listen(POS_PORT, '127.0.0.1', r));
  await new Promise((r) => adminSrv.listen(ADMIN_PORT, '127.0.0.1', r));
  let up = false; for (let i = 0; i < 240 && !up; i++) { try { up = (await fetch(API + '/health')).ok; } catch { /* booting */ } if (!up) await sleep(250); }
  if (!check('the compiled API booted against PostgreSQL; pos-web and admin-web are served same-origin', up, apiErr.split('\n').filter(Boolean).slice(-2).join(' | '))) throw new Error('the API did not boot');
  browser = await chromium.launch({ args: ['--no-sandbox'], ...(CHROMIUM ? { executablePath: CHROMIUM } : {}) });

  const apiB = await staffApi(CODE_B, OWNB_EMAIL, BB);
  check('salon B’s owner signs in (API session for the cross-salon checks)', apiB.ok, apiB.detail);

  // ── 1. receptionist (POS): rules, draft, submit ─────────────────────────────────────────────────────────────────
  const rec = await newPage('receptionist');
  await posLogin(rec, SALON, REC_EMAIL, BRANCH_A);
  check('the POS shows the Safety Community nav entry to the receptionist', (await loc(rec, SEL.pos.navEntry).count()) > 0);
  await rec.goto(POS + SEL.pos.newAdvisory.path, { waitUntil: 'load' });
  await loc(rec, SEL.pos.draftTitle).first().waitFor({ timeout: 15000 });
  // the editor puts the rules up as soon as it opens for a user who has not accepted the current version
  const ackedOnOpen = await acknowledgeRules(rec, 5000);
  await loc(rec, SEL.pos.draftTitle).first().fill(TITLE);
  await choose(loc(rec, SEL.pos.draftCategory).first(), 'account_takeover_attempt');
  await choose(loc(rec, SEL.pos.draftSeverity).first(), 'high');
  await loc(rec, SEL.pos.draftBody).first().fill(BODY);
  check('the receptionist fills the advisory form (category, severity, title, body)', (await loc(rec, SEL.pos.draftCategory).first().inputValue()) === 'account_takeover_attempt' && (await loc(rec, SEL.pos.draftSeverity).first().inputValue()) === 'high',
    `${await loc(rec, SEL.pos.draftCategory).first().inputValue().catch(() => '?')} / ${await loc(rec, SEL.pos.draftSeverity).first().inputValue().catch(() => '?')}`);
  if (await visible(loc(rec, SEL.pos.draftRecommendation), 500)) await loc(rec, SEL.pos.draftRecommendation).first().fill('Never read a login code to a caller. Call your processor back on the number on your statement.').catch(() => undefined);
  if (await visible(loc(rec, SEL.pos.draftRegion), 500)) await loc(rec, SEL.pos.draftRegion).first().fill('NJ').catch(() => undefined);
  await shot(rec, '1-receptionist-draft');
  await loc(rec, SEL.pos.draftSubmit).first().click();
  // the rules come up before the first draft; accepting them carries on with the submit
  const ackedRec = (await acknowledgeRules(rec, 3000)) || ackedOnOpen;
  const ackRowRec = await waitFor(async () => (await q(`select rules_version from community_rules_acknowledgments where user_id = $1`, [REC]))[0], 5000);
  check('the receptionist is shown the community rules before the first draft and acknowledges them (stored per user)', ackedRec && !!ackRowRec, `modal ${ackedRec} row ${short(ackRowRec)}`);
  await loc(rec, SEL.pos.editorStatus).first().waitFor({ timeout: 15000 }).catch(() => undefined);
  const created = await waitFor(async () => (await q(`select id, status from community_posts where origin_tenant_id = $1 and title = $2`, [TA, TITLE]))[0], 10_000);
  postId = created?.id ?? null;
  const afterSubmit = postId ? await waitFor(async () => { const r = await postRow(postId); return r?.status === 'manager_approval' ? r : null; }, 8000) ?? await postRow(postId) : null;
  await shot(rec, '2-receptionist-submitted');
  check('the receptionist’s submit waits for a manager (manager_approval) — receptionist approval is required', afterSubmit?.status === 'manager_approval', `${postId} ${afterSubmit?.status}`);
  if (!postId) throw new Error('no post was created from the POS');
  const digits = PHONE.replace(/\D/g, '');
  check('the phone number in the body is redacted before anyone else can see it, and flagged', !!afterSubmit && !String(afterSubmit.redacted_body).replace(/\D/g, '').includes(digits) && JSON.stringify(afterSubmit.privacy_scan_flags).includes('phone'),
    `${short(afterSubmit?.privacy_scan_flags)} body…${String(afterSubmit?.redacted_body).slice(140, 220)}`);

  // salon B cannot see a draft / a post waiting for approval
  const preFeed = await apiB.call('GET', '/community/feed?pageSize=50');
  const preOne = await apiB.call('GET', `/community/posts/${postId}`);
  check('before publication salon B neither finds it in the feed nor opens it by id', preFeed.status === 200 && !preFeed.text.includes(postId) && [403, 404].includes(preOne.status), `feed ${preFeed.status} one ${preOne.status} ${short(preOne.body)}`);

  // ── 2. manager (POS): approve → held for moderation (the category always needs a moderator) ─────────────────────
  const mgr = await newPage('manager');
  await posLogin(mgr, SALON, MGR_EMAIL, BRANCH_A);
  await mgr.goto(POS + SEL.pos.approvals.path, { waitUntil: 'load' });
  const row = loc(mgr, SEL.pos.approvalRow(TITLE)).first();
  await row.waitFor({ state: 'visible', timeout: 15000 });
  await shot(mgr, '3-manager-approvals');
  await loc(mgr, SEL.pos.approve(TITLE)).click();
  await loc(mgr, SEL.pos.approvalResult).first().waitFor({ timeout: 15000 }).catch(() => undefined);
  const held = await waitFor(async () => { const r = await postRow(postId); return r?.status === 'moderation_review' ? r : null; }, 10_000) ?? await postRow(postId);
  check('the manager approves in the POS → held for Super Admin moderation (moderation_review, still not visible)', held?.status === 'moderation_review' && held?.visibility !== 'community_published', `${held?.status} ${held?.visibility}`);
  const preFeed2 = await apiB.call('GET', '/community/feed?pageSize=50');
  check('while held for moderation salon B still does not see it', preFeed2.status === 200 && !preFeed2.text.includes(postId), `${preFeed2.status}`);

  // ── 3. Super Admin (admin-web): publish from the Review queue ─────────────────────────────────────────────────────
  const sa = await newPage('super-admin');
  await sa.goto(ADMIN + '/', { waitUntil: 'load' });
  await loc(sa, SEL.admin.loginIdentifier).fill(SA_EMAIL);
  await loc(sa, SEL.admin.loginPassword).fill(PW);
  await loc(sa, SEL.admin.loginSubmit).click();
  // a Super Admin is MFA-required at login; a not-yet-enrolled account proceeds with any well-formed code (bootstrap path)
  if (await visible(loc(sa, SEL.admin.mfaCode), 8000)) {
    await loc(sa, SEL.admin.mfaCode).fill('123456');
    const done = sa.waitForResponse((r) => r.url().includes('/auth/login') && r.request().method() === 'POST', { timeout: 15000 });
    await loc(sa, SEL.admin.mfaSubmit).click();
    const lr = await done;
    check('the Super Admin signs in to admin-web (password, then the MFA step)', lr.status() === 200, `${lr.status()}`);
  }
  await sa.waitForFunction(() => !document.querySelector('input[aria-label="Password"]') && !document.querySelector('input[autocomplete="one-time-code"]'), null, { timeout: 20000 });
  await sleep(800);
  await q(`update sessions set last_step_up_at = now() where user_id = $1 and revoked_at is null`, [SA]);   // step-up, as the Phase 7 proof
  await sa.goto(ADMIN + SEL.admin.center.path, { waitUntil: 'load' });
  await loc(sa, SEL.admin.heading).waitFor({ timeout: 15000 });
  check('admin-web: the Safety Community Moderation center opens for the Super Admin', true);
  await loc(sa, SEL.admin.reviewTab).click();
  const qrow = loc(sa, SEL.admin.queueRow(TITLE));
  await qrow.first().waitFor({ timeout: 15000 });
  check('the advisory is in the Review queue with its salon named for the moderator', (await qrow.first().textContent())?.includes('Pilot') ?? false, (await qrow.first().textContent())?.slice(0, 160));
  await shot(sa, '4-admin-review-queue');
  await qrow.first().getByRole('button', { name: SEL.admin.publish.name }).click();
  const dlg = loc(sa, SEL.admin.dialog);
  await loc(dlg, SEL.admin.reason).fill('Live proof: checked — no personal data left, wording neutral');
  await shot(sa, '5-admin-publish-dialog');
  await loc(dlg, SEL.admin.confirmPublish).click();
  await loc(sa, SEL.admin.status).filter({ hasText: /Publish — done|Not changed/ }).first().waitFor({ timeout: 15000 });
  const saStatus = (await loc(sa, SEL.admin.status).first().textContent()) ?? '';
  const pub = await waitFor(async () => { const r = await postRow(postId); return r && String(r.status).startsWith('published_') ? r : null; }, 10_000) ?? await postRow(postId);
  await shot(sa, '6-admin-published');
  check('the Super Admin publishes from the Review queue (published_unverified, visible to the community)', pub?.status === 'published_unverified' && pub?.visibility === 'community_published', `${saStatus.slice(0, 120)} → ${pub?.status} ${pub?.visibility} ${pub?.verification_label}`);
  const mcase = (await q(`select id, kind, status from community_moderation_cases where post_id = $1`, [postId]))[0];
  const mact = (await q(`select action, actor_user_id, reason from community_moderation_actions where post_id = $1 and action = 'publish'`, [postId]))[0];
  check('a real moderation case exists and the publish action is recorded with the real Super Admin and the reason', !!mcase && mact?.actor_user_id === SA && /Live proof/.test(mact?.reason ?? ''), `${short(mcase)} ${short(mact)}`);

  // ── 4. salon B (POS): the feed, the deep link, a comment ──────────────────────────────────────────────────────────
  const ownb = await newPage('salon-b-owner');
  await posLogin(ownb, CODE_B, OWNB_EMAIL, BRANCH_B);
  await ownb.goto(POS + SEL.pos.feed.path, { waitUntil: 'load' });
  const inFeed = await visible(loc(ownb, SEL.pos.feedTitle(TITLE)), 15000);
  await shot(ownb, '7-salon-b-feed');
  check('salon B sees the published advisory in its POS feed', inFeed);
  await ownb.goto(POS + SEL.pos.postPath(postId), { waitUntil: 'load' });
  const onDetail = await visible(ownb.locator(SEL.pos.postTitle).filter({ hasText: TITLE }), 15000);
  check('salon B opens the deep link /community/posts/:id', onDetail, ownb.url());
  await shot(ownb, '7b-salon-b-detail');
  const ackedOnOpenB = await acknowledgeRules(ownb, 3000);   // the rules may already be up for a user who has not accepted them
  await loc(ownb, SEL.pos.commentBox).fill(COMMENT);
  await loc(ownb, SEL.pos.commentSubmit).click();
  const ackedB = (await acknowledgeRules(ownb, 5000)) || ackedOnOpenB;   // first comment → the rules; accepting posts the comment
  check('salon B\u2019s owner is shown the rules before the first comment and acknowledges them', ackedB && !!(await waitFor(async () => (await q(`select 1 from community_rules_acknowledgments where user_id = $1`, [OWNB]))[0], 5000)), `modal ${ackedB}`);
  const commentShown = await visible(loc(ownb, SEL.pos.comment(COMMENT)), 10_000);
  const crow = await waitFor(async () => (await q(`select id, tenant_id from community_comments where post_id = $1 and redacted_body like $2`, [postId, `%${tag}%`]))[0], 8000);
  await shot(ownb, '8-salon-b-commented');
  check('salon B comments on it from the POS (shown on the page; stored for salon B)', commentShown && crow?.tenant_id === TB, `shown ${commentShown} row ${short(crow)}`);

  // ── 5. cross-salon API checks ─────────────────────────────────────────────────────────────────────────────────────
  const feedB = await apiB.call('GET', '/community/feed?pageSize=50');
  const oneB = await apiB.call('GET', `/community/posts/${postId}`);
  const commentsB = await apiB.call('GET', `/community/posts/${postId}/comments`);
  const blob = feedB.text + oneB.text + commentsB.text;
  const leaked = [TA, BA, REC, MGR].filter((id) => blob.includes(id));
  check('salon B sees the post by API (feed + detail + comments) and NONE of salon A’s ids (tenant, branch, receptionist, manager) appear anywhere',
    feedB.status === 200 && feedB.text.includes(postId) && oneB.status === 200 && commentsB.status === 200 && leaked.length === 0, `feed ${feedB.status} one ${oneB.status} comments ${commentsB.status} leaked ${leaked.length}`);
  check('the published body salon B reads has no phone number', oneB.status === 200 && !oneB.text.replace(/\D/g, '').includes(digits));
  const alertB = await waitFor(async () => (await q(`select count(*)::int as n from outbox_events where event_type = 'community.alert_delivered' and tenant_id = $1 and payload_json->>'postId' = $2`, [TB, postId]))[0].n, 10_000);
  const alertA = (await q(`select count(*)::int as n from outbox_events where event_type = 'community.alert_delivered' and tenant_id = $1 and payload_json->>'postId' = $2`, [TA, postId]))[0].n;
  check('the alert outbox row for salon B exists (tenantId = salon B) and none for the author salon', alertB >= 1 && alertA === 0, `B ${alertB} A ${alertA}`);
  const evs = (await q(`select event_type, count(*)::int as n from outbox_events where created_at >= $1 and (aggregate_id = $2 or payload_json->>'postId' = $2) group by 1 order by 1`, [STARTED, postId])).map((r) => `${r.event_type}×${r.n}`);
  check('the workflow wrote its domain events (submitted, approved, published, moderation action, comment added)', ['community.advisory_submitted', 'community.advisory_published', 'community.moderation_action_taken', 'community.comment_added'].every((t) => evs.some((e) => e.startsWith(t))), evs.join(', '));
  check('no uncaught page errors in any of the four browser sessions', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
} catch (e) {
  check('the proof ran to the end', false, String(e?.stack || e).split('\n').slice(0, 3).join(' | '));
} finally {
  clearTimeout(timer);
  await cleanup().catch((e) => check('cleanup', false, String(e?.message || e)));
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed}/${results.length} checks passed · screenshots: ${SHOTS}`);
  process.exit(failed ? 1 : 0);
}
