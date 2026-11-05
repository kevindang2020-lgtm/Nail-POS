#!/usr/bin/env node
// audit-response-exposure.mjs — BUILD_PLAN Phase 12 / Constitution 5 §37 + §138 (API_DEFINITION_OF_DONE #19):
// "Do not return raw database rows automatically" and "return only needed data".
//
// Statically finds every read that could ship a whole row or a sensitive column to a response:
//   * `selectFrom('t') … .selectAll()` / `.returningAll()`, `select * from t`, `select x.* from t x` (alias resolved),
//     `returning *` on `insert into t` / `update t` — a STAR read;
//   * a SENSITIVE column (credential, sealed secret, card / bank number, token, password / PIN / code hash, phone hash)
//     named in a select list of its table — a COLUMN read.
// Columns come from the typed schema (packages/database/src/kysely.types.ts, which check:types-drift keeps equal to the
// migrations); the pgtest (src/common/response-exposure.pgtest.vitest.spec.ts) checks the classifier against the MIGRATED
// schema so this audit cannot go blind to a column the types file lacks.
//
// The gate (check:response-exposure):
//   1. a STAR or COLUMN read of a table that HAS a sensitive column fails unless the file is REVIEWED — on the
//      check:secrets allowlist (credential checks in-process, reviewed Sep 29 2026) or on this audit's own reviewed list
//      (tooling/ci/response-exposure.allowlist.json → reviewed) with the reason the value never reaches a response;
//   2. STAR reads of tables WITHOUT a sensitive column are a ratchet (allowlist → starBaseline, per file): a file may not
//      add one; a file that loses one must shrink its entry (--update), so the count only goes down;
//   3. every response wire type in packages/api-contracts is scanned: no property may carry a sensitive column's name.
//   --json prints the full inventory; --update rewrites the star baseline (never the reviewed list).
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname, '..', '..');
const ALLOWLIST = join(ROOT, 'tooling/ci/response-exposure.allowlist.json');

// ── the sensitive-column classifier (shared with the pgtest via export) ──────────────────────────────────────────
// Credentials and their sealed / hashed forms, raw payment instruments, and lookup hashes of personal data.
// NOT content / dedupe hashes (file_hash, import_hash, prompt_hash, query_hash, request_hash, perceptual_hash),
// NOT counters (input_tokens …), NOT masks / fingerprints / last-4 / prefixes, NOT boolean flags about a secret.
export const SENSITIVE_COL = /^(.*_enc|.*_ciphertext|.*secret.*|password_hash|.*_password_hash|temporary_password_hash|pin_hash|.*_pin_hash|.*_code_hash|code_hash|code_enc|token|.*_token|token_hash|.*_token_hash|.*_key_hash|.*_access_code_hash|otp_hash|otp_code|api_key|auth_key|private_key|client_secret|access_token|refresh_token|card_number|card_number_hash|account_number|routing_number|bank_account_number|phone_hash|.*_phone_hash)$/i;
export const NOT_SENSITIVE = /^(id|status|.*_at|.*_id|is_.*|has_.*|.*_count|.*_tokens|.*_prefix|.*_last4|.*_last_4|.*_masked|.*_fingerprint|.*_type|file_hash|import_hash|prompt_hash|query_hash|request_hash|perceptual_hash|content_hash|body_hash|via_previous_secret|api_key_sid)$/i;
export const isSensitiveColumn = (c) => SENSITIVE_COL.test(c) && !NOT_SENSITIVE.test(c);

// ── schema from the typed schema file ───────────────────────────────────────────────────────────────────────────
export function schemaColumns(typesSrc = readFileSync(join(ROOT, 'packages/database/src/kysely.types.ts'), 'utf8')) {
  const iface = new Map();
  // brace-matched, not "up to the next \n}": a ONE-LINE interface (`export interface X { a: string; }`) followed by
  // others used to swallow them, leaving oauth_tokens / security_not_me_tokens / … with no columns — the pgtest caught it
  const body = (at) => {
    let depth = 0;
    for (let i = at; i < typesSrc.length; i++) {
      const ch = typesSrc[i];
      if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) return typesSrc.slice(at + 1, i);
    }
    return '';
  };
  for (const m of typesSrc.matchAll(/export interface (\w+)[^{]*\{/g)) {
    const b = body(m.index + m[0].length - 1).replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    iface.set(m[1], [...b.matchAll(/(?:^|[;{\n])\s*([a-z_][a-z0-9_]*)\??\s*:/g)].map((x) => x[1]));
  }
  const dbAt = /export interface DB\s*\{/.exec(typesSrc);
  const db = dbAt ? body(dbAt.index + dbAt[0].length - 1) : '';
  const tables = new Map();
  for (const m of db.matchAll(/^\s*([a-z_][a-z0-9_]*)\s*:\s*(\w+)\s*;/gm)) tables.set(m[1], iface.get(m[2]) ?? []);
  return tables;
}

function* walk(d) {
  for (const n of readdirSync(d)) {
    if (n === 'node_modules' || n === 'dist' || n.startsWith('.')) continue;
    const p = join(d, n); const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (p.endsWith('.ts') && !/\.(spec|test)\.ts$|vitest|pgtest|\.d\.ts$/.test(p)) yield p;
  }
}
const lineOf = (src, i) => src.slice(0, i).split('\n').length;
/** A select / returning list as the audit reads it: string literals blanked, and output ALIASES dropped — `(x_enc IS NOT
 *  NULL) AS x_enc` returns a boolean named like the column, not the column (ai_providers, Oct 8 2026). */
const selectList = (l) => l.replace(/'[^']*'/g, "''").replace(/\bas\s+"?[a-z_][a-z0-9_]*"?/gi, ' ');

/** Every star / sensitive-column read in one source file. */
export function readsIn(src, tables, sensitive) {
  const out = [];
  // Kysely selectFrom('t' [as a]) … selectAll() — the chain up to the next selectFrom / statement end
  for (const m of src.matchAll(/selectFrom\(\s*'([a-z_][a-z0-9_]*)(?:\s+as\s+(\w+))?'\s*\)/g)) {
    const t = m[1]; if (!tables.has(t)) continue;
    const rest = src.slice(m.index + m[0].length);
    const stop = rest.search(/selectFrom\(|;\s*\n|\n\s*\n/);
    const chain = stop < 0 ? rest.slice(0, 1200) : rest.slice(0, stop);
    const sa = /\.selectAll\(\s*(?:'([a-z_][a-z0-9_]*)')?\s*\)/.exec(chain);
    if (sa && (!sa[1] || sa[1] === t || sa[1] === m[2])) out.push({ table: t, kind: 'star', line: lineOf(src, m.index) });
    for (const sel of chain.matchAll(/\.select\(\s*(\[[\s\S]*?\]|'[^']*')/g)) {
      for (const c of sel[1].matchAll(/'(?:\w+\.)?([a-z_][a-z0-9_]*)(?:\s+as\s+\w+)?'/g)) if (sensitive.get(t)?.has(c[1])) out.push({ table: t, kind: 'column', col: c[1], line: lineOf(src, m.index) });
    }
  }
  for (const m of src.matchAll(/(?:insertInto|updateTable)\(\s*'([a-z_][a-z0-9_]*)'\s*\)/g)) {
    const rest = src.slice(m.index, m.index + 900); const stop = rest.slice(1).search(/insertInto\(|updateTable\(|selectFrom\(|;\s*\n/);
    if (/\.returningAll\(\)/.test(stop < 0 ? rest : rest.slice(0, stop + 1)) && tables.has(m[1])) out.push({ table: m[1], kind: 'star', line: lineOf(src, m.index) });
  }
  // raw SQL: select-list … from t [alias] (also joins) — star, alias-star, sensitive column
  for (const m of src.matchAll(/\bselect\s+(distinct\s+(?:on\s*\([^)]*\)\s*)?)?([\s\S]{1,1500}?)\s+from\s+([a-z_][a-z0-9_]*)(?:\s+(?:as\s+)?([a-z_][a-z0-9_]*))?/gi)) {
    const list = m[2]; const t = m[3].toLowerCase();
    if (/\bselect\b/i.test(list)) continue;   // nested select — the inner one is matched on its own
    const tail = src.slice(m.index + m[0].length, m.index + m[0].length + 1500);
    const aliases = new Map(); if (tables.has(t)) aliases.set((m[4] && !/^(where|join|left|inner|on|group|order|limit|cross|right|full|union|for|natural|using)$/i.test(m[4]) ? m[4] : t).toLowerCase(), t);
    for (const j of tail.split(/\bselect\b/i)[0].matchAll(/\bjoin\s+([a-z_][a-z0-9_]*)(?:\s+(?:as\s+)?([a-z_][a-z0-9_]*))?/gi)) {
      const jt = j[1].toLowerCase(); if (!tables.has(jt)) continue;
      aliases.set((j[2] && !/^(on|using)$/i.test(j[2]) ? j[2] : jt).toLowerCase(), jt);
    }
    if (!aliases.size) continue;
    const line = lineOf(src, m.index);
    if (/^\s*\*\s*$|^\s*\*\s*,|,\s*\*\s*$/.test(list) && tables.has(t)) out.push({ table: t, kind: 'star', line });
    for (const s of list.matchAll(/\b([a-z_][a-z0-9_]*)\.\*/gi)) { const at = aliases.get(s[1].toLowerCase()); if (at) out.push({ table: at, kind: 'star', line }); }
    for (const [, at] of aliases) for (const c of sensitive.get(at) ?? []) {
      if (new RegExp(`(^|[\\s,(.])${c}\\b(?!\\s*(?:=|is\\b|<>|!=))`, 'i').test(selectList(list))) out.push({ table: at, kind: 'column', col: c, line });
    }
  }
  for (const m of src.matchAll(/\b(?:insert\s+into|update)\s+([a-z_][a-z0-9_]*)\b([^;`]{0,2000}?)\breturning\s+([^;`]*)/gi)) {
    const t = m[1].toLowerCase(); if (!tables.has(t)) continue;
    if (/\breturning\b/i.test(m[2])) continue;
    const ret = m[3].split(/\n\s*\n/)[0];
    if (/(^|,)\s*(?:[a-z_]+\.)?\*\s*(,|$|\)|\s)/i.test(ret)) out.push({ table: t, kind: 'star', line: lineOf(src, m.index) });
    for (const c of sensitive.get(t) ?? []) if (new RegExp(`(^|[\\s,(.])${c}\\b(?!\\s*(?:=|is\\b|<>|!=))`, 'i').test(selectList(ret))) out.push({ table: t, kind: 'column', col: c, line: lineOf(src, m.index) });
  }
  // de-duplicate (two patterns can see one statement)
  const seen = new Set();
  return out.filter((x) => { const k = `${x.table}|${x.kind}|${x.col ?? ''}|${x.line}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** The check:secrets reviewed allowlist (one source: its keys are file fragments). */
function secretsReviewed() {
  const src = readFileSync(join(ROOT, 'apps/api/scripts/secrets-exposure-check.mjs'), 'utf8');
  const block = /const ALLOW = \{([\s\S]*?)\n\};/.exec(src)?.[1] ?? '';
  return [...block.matchAll(/^\s*'([^']+)'\s*:/gm)].map((m) => m[1]);
}

/** Response wire types in one source whose property names are a sensitive column's name (snake or camel). */
export function typeLeaks(src, sensitiveNames) {
  const leaks = [];
  const camel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
  const names = new Set([...sensitiveNames].flatMap((c) => [c, camel(c)]));
  for (const m of src.matchAll(/export (?:interface|type) (\w+)[^{=]*[{=]([\s\S]*?)\n\}/g)) {
    if (/Request|Input|Body|Params|Query|Command|Payload$/.test(m[1])) continue;   // what a client SENDS (a new password, a PIN to set) is not exposure
    for (const p of m[2].matchAll(/(?:^|[;{\n,])\s*(?:readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)\??\s*:/g)) if (names.has(p[1])) leaks.push({ type: m[1], prop: p[1] });
  }
  return leaks;
}

/** Every response wire type in packages/api-contracts, scanned with typeLeaks. */
export function contractLeaks(sensitiveNames) {
  const leaks = [];
  for (const f of walk(join(ROOT, 'packages/api-contracts/src'))) for (const l of typeLeaks(readFileSync(f, 'utf8'), sensitiveNames)) leaks.push({ file: f.replace(ROOT + '/', ''), ...l });
  return leaks;
}

export const loadAllowlist = () => (existsSync(ALLOWLIST) ? JSON.parse(readFileSync(ALLOWLIST, 'utf8')) : { reviewed: {}, notSensitive: {}, starBaseline: {} });

/** The Phase 10 ownership registry's table sensitivity (classify-schema classes) — the second opinion on the column classifier. */
export const registrySensitivity = () => {
  const p = join(ROOT, 'apps/api/db/ownership/registry.generated.json');
  return existsSync(p) ? Object.fromEntries(Object.entries(JSON.parse(readFileSync(p, 'utf8')).tables).map(([t, v]) => [t, v.sensitivity])) : {};
};

/** Controller handlers and whether their declared return type names a type imported from @aipowersalon/api-contracts
 *  (#19 "every response type that is not an api-contracts type" — an inventory; the contract test (#52) owns the gate). */
export function responseTypeInventory() {
  let total = 0, typed = 0;
  for (const root of [join(ROOT, 'apps/api/src'), join(ROOT, 'modules')]) for (const f of walk(root)) {
    if (!f.endsWith('.controller.ts')) continue;
    const src = readFileSync(f, 'utf8');
    const contractNames = new Set([...src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'@aipowersalon\/api-contracts[^']*'/g)].flatMap((m) => m[1].split(',').map((x) => x.replace(/\btype\b/, '').trim().split(/\s+as\s+/).pop()).filter(Boolean)));
    for (const m of src.matchAll(/@(?:Get|Post|Put|Patch|Delete)\(/g)) {
      // skip the decorator chain (each `@X(...)`, parens balanced) to the method name, then its balanced parameter list
      let i = m.index; const bal = (k) => { let d = 0; for (; k < src.length; k++) { if (src[k] === '(') d++; else if (src[k] === ')' && --d === 0) return k + 1; } return k; };
      for (;;) {
        while (/\s/.test(src[i])) i++;
        if (src[i] !== '@') break;
        const open = src.indexOf('(', i); const nl = src.slice(i, open).search(/\s/);
        if (open < 0 || nl >= 0) { i += 1; while (/[\w.]/.test(src[i])) i++; continue; }   // a decorator without arguments
        i = bal(open);
      }
      const head = /^(?:(?:public|private|protected|async|static)\s+)*([A-Za-z_]\w*)\s*\(/.exec(src.slice(i));
      if (!head) continue;
      total++;
      const after = bal(i + head[0].length - 1);
      const rt = /^\s*:\s*([^{]+?)\s*\{/.exec(src.slice(after, after + 400))?.[1] ?? '';
      if ([...contractNames].some((n) => new RegExp(`\\b${n}\\b`).test(rt))) typed++;
    }
  }
  return { total, typed };
}

export function audit(allow = loadAllowlist()) {
  const tables = schemaColumns();
  const sensitive = new Map();
  const notSensitive = new Set(Object.keys(allow.notSensitive ?? {}));
  for (const [t, cols] of tables) { const s = cols.filter((c) => isSensitiveColumn(c) && !notSensitive.has(`${t}.${c}`)); if (s.length) sensitive.set(t, new Set(s)); }
  const reads = [];
  for (const root of [join(ROOT, 'apps/api/src'), join(ROOT, 'modules')]) for (const f of walk(root)) {
    const rel = f.replace(ROOT + '/', ''); const src = readFileSync(f, 'utf8');
    for (const r of readsIn(src, tables, sensitive)) reads.push({ file: rel, ...r, sensitiveTable: sensitive.has(r.table) });
  }
  return { tables, sensitive, reads };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const allow = loadAllowlist();
  const { tables, sensitive, reads } = audit(allow);
  const staleNotSensitive = Object.keys(allow.notSensitive ?? {}).filter((k) => { const [t, c] = k.split('.'); return !(tables.get(t) ?? []).includes(c) || !isSensitiveColumn(c); });
  const reviewedKeys = [...secretsReviewed(), ...Object.keys(allow.reviewed ?? {})];
  const reviewedBy = (file) => reviewedKeys.find((k) => file.includes(k));
  const risky = reads.filter((r) => r.sensitiveTable);
  const open = risky.filter((r) => !reviewedBy(r.file));
  const plainStar = reads.filter((r) => !r.sensitiveTable && r.kind === 'star');
  const starByFile = {}; for (const r of plainStar) starByFile[r.file] = (starByFile[r.file] ?? 0) + 1;
  // a reviewed file is reviewed for the reads it HAD: one more sensitive read there is a new review (counted, like stars)
  const reviewedByFile = {}; for (const r of risky) if (reviewedBy(r.file)) reviewedByFile[r.file] = (reviewedByFile[r.file] ?? 0) + 1;
  const leaks = contractLeaks(new Set([...sensitive.values()].flatMap((s) => [...s])));
  const reg = registrySensitivity();
  const restrictedStar = plainStar.filter((r) => ['SECURITY_SECRET', 'PAYMENT_RESTRICTED'].includes(reg[r.table]));
  const rt = responseTypeInventory();
  if (process.argv.includes('--json')) { console.log(JSON.stringify({ reads, open, leaks, restrictedStar, responseTypes: rt }, null, 2)); await new Promise((r) => process.stdout.write('', r)); process.exit(0); }
  if (process.argv.includes('--update')) {
    const sorted = Object.fromEntries(Object.entries(starByFile).sort(([a], [b]) => a.localeCompare(b)));
    const rsorted = Object.fromEntries(Object.entries(reviewedByFile).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(ALLOWLIST, JSON.stringify({ ...allow, reviewedBaseline: rsorted, starBaseline: sorted }, null, 2) + '\n');
    console.log(`response-exposure: star baseline written (${plainStar.length} star reads in ${Object.keys(sorted).length} files)`); process.exit(0);
  }
  const base = allow.starBaseline ?? {};
  const grew = Object.entries(starByFile).filter(([f, n]) => n > (base[f] ?? 0));
  const shrunk = Object.entries(base).filter(([f, n]) => (starByFile[f] ?? 0) < n);
  const staleReviewed = Object.keys(allow.reviewed ?? {}).filter((k) => !risky.some((r) => r.file.includes(k)));
  let fail = false;
  for (const r of open) { fail = true; console.log(`FINDING  ${r.file}:${r.line}  ${r.kind === 'star' ? `${r.table}.*` : `${r.table}.${r.col}`}  (table has ${[...sensitive.get(r.table)].join(', ')}) — select the columns the response needs, or review it`); }
  for (const [f, n] of grew) { fail = true; console.log(`STAR     ${f}  ${n} whole-row reads (baseline ${base[f] ?? 0}) — select the columns the response needs`); }
  const rbase = allow.reviewedBaseline ?? {};
  for (const [f, n] of Object.entries(reviewedByFile)) if (n > (rbase[f] ?? 0)) { fail = true; console.log(`REVIEW   ${f}  ${n} sensitive reads (reviewed ${rbase[f] ?? 0}) — a new read of a sensitive column needs its own review (then --update)`); }
  for (const [f, n] of Object.entries(rbase)) if ((reviewedByFile[f] ?? 0) < n) { fail = true; console.log(`SHRINK   ${f}  reviewed ${n} → ${reviewedByFile[f] ?? 0}: run node apps/api/scripts/audit-response-exposure.mjs --update`); }
  for (const [f, n] of shrunk) { fail = true; console.log(`SHRINK   ${f}  baseline ${n} → ${starByFile[f] ?? 0}: run node apps/api/scripts/audit-response-exposure.mjs --update`); }
  for (const k of staleReviewed) { fail = true; console.log(`STALE    reviewed entry '${k}' matches no sensitive read — remove it`); }
  for (const k of staleNotSensitive) { fail = true; console.log(`STALE    notSensitive entry '${k}' is not a column the classifier flags — remove it`); }
  for (const l of leaks) { fail = true; console.log(`CONTRACT ${l.file}  ${l.type}.${l.prop} — a response type carries a sensitive column`); }
  console.log(`response-exposure: ${tables.size} tables (${sensitive.size} with sensitive columns); ${reads.length} reads — ${risky.length} touch a sensitive table (${risky.length - open.length} reviewed, ${open.length} open), ${plainStar.length} whole-row reads of non-sensitive tables in ${Object.keys(starByFile).length} files (ratchet; ${restrictedStar.length} of them on registry SECURITY_SECRET / PAYMENT_RESTRICTED tables with no sensitive column); ${leaks.length} contract leaks; handlers with an api-contracts return type: ${rt.typed}/${rt.total}`);
  process.exit(fail ? 1 : 0);
}
