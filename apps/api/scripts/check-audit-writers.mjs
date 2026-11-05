#!/usr/bin/env node
// check-audit-writers.mjs — BUILD_PLAN Phase 10 (Constitution 1 §32–§33): audit rows are written through the audit module.
//
// AuditService.record (modules/audit) is what fills an audit_events row's request / correlation / session ids, its
// before / after state and its reason (migration 541). A raw `insert into audit_events` / `audit_logs` elsewhere writes
// a row with none of that, and skips the redaction of sensitive metadata keys. So: no NEW raw audit writer outside
// modules/audit. The writers that existed on Oct 8 2026 are listed in apps/api/security/audit-writers.allowlist.json
// (file → count, with the reason); the list only shrinks — a new file, or more writes in a listed file, fails.
// audit_logs stays the tenant-facing / platform log (decided Phase 10: both tables are append-only; audit_events is the
// structured trail), which is why its writers are counted too.
//
//   node apps/api/scripts/check-audit-writers.mjs           gate
//   node apps/api/scripts/check-audit-writers.mjs --list    every raw writer with its count
//   node apps/api/scripts/check-audit-writers.mjs --strict  also fail on allowlist entries that over-count (stale)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const ALLOWLIST = join(HERE, '../security/audit-writers.allowlist.json');
const ROOTS = ['modules', 'apps/api/src', 'packages'];
const OWNER = /^modules\/audit\/src\//;                      // the audit module itself may write
const SKIP = /(^|\/)(dist|node_modules|\.harness)(\/|$)|\.(spec|test)\.ts$|\.d\.ts$|kysely\.types\.ts$/;
export const WRITER_RE = /insert\s+into\s+(?:public\.)?["']?(audit_events|audit_logs)\b|insertInto\(\s*['"](audit_events|audit_logs)['"]/gi;

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name); const rel = relative(REPO, p);
    if (SKIP.test(rel)) continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|mjs|js)$/.test(name)) out.push(rel);
  }
  return out;
}

export function scan() {
  const found = new Map();
  for (const r of ROOTS) {
    const abs = join(REPO, r); if (!existsSync(abs)) continue;
    for (const rel of walk(abs, [])) {
      if (OWNER.test(rel)) continue;
      const n = [...readFileSync(join(REPO, rel), 'utf8').matchAll(WRITER_RE)].length;
      if (n) found.set(rel, n);
    }
  }
  return found;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const found = scan();
  if (process.argv.includes('--list')) { for (const [f, n] of [...found].sort()) console.log(`${String(n).padStart(3)}  ${f}`); process.exit(0); }
  const allow = JSON.parse(readFileSync(ALLOWLIST, 'utf8'));
  const byFile = new Map(allow.entries.map((e) => [e.file, e]));
  const fails = []; const stale = [];
  for (const [f, n] of found) {
    const e = byFile.get(f);
    if (!e) fails.push(`${f}: ${n} raw audit write(s) outside modules/audit — record through AuditService / auditSinkFor (modules/audit) instead`);
    else if (n > e.count) fails.push(`${f}: ${n} raw audit writes, the allowlist caps it at ${e.count} — the list only shrinks`);
    else if (n < e.count) stale.push(`${f}: ${n} < ${e.count} (lower the count)`);
  }
  for (const e of allow.entries) if (!found.has(e.file)) stale.push(`${e.file}: no raw audit writes left (remove the entry)`);
  if (stale.length) console.log(`audit-writers: ${stale.length} allowlist entr${stale.length === 1 ? 'y is' : 'ies are'} stale:\n  ` + stale.join('\n  '));
  if (fails.length || (process.argv.includes('--strict') && stale.length)) {
    console.error(`check:audit-writers FAILED\n  ` + fails.join('\n  '));
    process.exit(1);
  }
  console.log(`check:audit-writers ok — ${found.size} allowlisted legacy writer file(s), no new raw audit writer`);
}
