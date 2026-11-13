#!/usr/bin/env node
/* global process, console */
// frozen-shell.mjs — OWNER FREEZE (Kevin, Nov 13 2026, booking200 addendum §03 / P-01): the shared POS TOP BAR and the
// employee POS SIDEBAR are frozen. This file computes the content fingerprint of exactly those sources — the React
// components, the sidebar's route/nav data and access gating, the top-bar widgets, and the CSS rules in styles.css whose
// selectors target the shell (.topbar / .sidebar / .sidefoot / .nav / .navlink / .shell) — and compares it with the
// approved fingerprint in apps/pos-web/src/guards/frozen-shell.lock.json. The test apps/pos-web/src/guards/
// frozen-shell.test.ts fails on ANY difference.
//
// UPDATE PROCEDURE (owner approval required — never "just regenerate" to make the test pass):
//   1. Get the owner's explicit written approval for the specific top-bar / sidebar change (who, when, why).
//   2. Make the change in its own commit.
//   3. Run:  node apps/pos-web/scripts/frozen-shell.mjs --approve "<owner name>" --reason "<what was approved and why>"
//      It rewrites the lock's fingerprints and APPENDS an entry to its `approvals` history (it never removes one).
//   4. The commit message names the approval. A lock change without a new approvals entry fails the test.
// Without --approve the script only prints the current fingerprint and the files that differ (read-only).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const POS_ROOT = join(HERE, '..');                       // apps/pos-web
export const LOCK_PATH = join(POS_ROOT, 'src/guards/frozen-shell.lock.json');

/** The frozen sources (paths relative to apps/pos-web). */
export const FROZEN_FILES = [
  'src/shell/POSLayout.tsx',               // the shell: sidebar <aside>, top bar <header>, clock, bell, messages, location selector
  'src/shell/tenant-nav.tsx',              // the sidebar's destinations, routes, icons
  'src/shell/tenant-access.ts',            // the sidebar's access gating and badges
  'src/shell/TopSearch.tsx',               // top-bar global search
  'src/shell/ProfileMenu.tsx',             // top-bar user menu
  'src/shell/LanguageSwitch.tsx',          // top-bar EN / VI switch
  'src/shell/PlatformAnnouncementBar.tsx', // the announcement line under the top bar
  'src/shell/AlertReadPanel.tsx',          // top-bar notifications panel
  'src/shell/BadgeCheckDialog.tsx',        // sidebar badge check
  'src/realtime/RealtimeStatusPill.tsx',   // the live-status pill in the top bar
];
export const STYLES_PATH = 'src/styles.css';
/** a selector that targets the shell (the class must end there: `.nav` yes, `.nav-tabs` no) */
export const SHELL_SELECTOR = /(^|[\s,>+~(])\.(topbar|sidebar|sidefoot|nav|navlink|shell)(?![\w-])/;

const norm = (s) => s.replace(/\r\n/g, '\n');
const sha = (s) => createHash('sha256').update(s).digest('hex');

/** Flattened CSS rules: { sel, body } with any enclosing @media / @supports / @container prefixed to `sel`. */
export function cssRules(css) {
  const src = norm(css).replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  (function parse(s, prefix) {
    let i = 0;
    while (i < s.length) {
      const open = s.indexOf('{', i);
      if (open < 0) break;
      const head = s.slice(i, open); const sel = head.split(';').pop().trim();   // drop a preceding @import / @charset
      let depth = 1, j = open + 1;
      while (j < s.length && depth > 0) { if (s[j] === '{') depth++; else if (s[j] === '}') depth--; j++; }
      const body = s.slice(open + 1, j - 1);
      if (/^@(media|supports|container|layer)\b/.test(sel)) parse(body, prefix + sel.replace(/\s+/g, ' ') + ' ');
      else out.push({ sel: (prefix + sel).replace(/\s+/g, ' '), body: body.replace(/\s+/g, ' ').trim() });
      i = j;
    }
  })(src, '');
  return out;
}

export function shellCssRules(css) {
  return cssRules(css).filter((r) => SHELL_SELECTOR.test(r.sel));
}

/** The current fingerprint of the frozen shell. */
export function computeFrozenShell(root = POS_ROOT) {
  const files = {};
  for (const f of FROZEN_FILES) {
    const p = join(root, f);
    files[f] = existsSync(p) ? sha(norm(readFileSync(p, 'utf8'))) : 'MISSING';
  }
  const rules = shellCssRules(readFileSync(join(root, STYLES_PATH), 'utf8'));
  return { files, shellCss: { rules: rules.length, sha256: sha(rules.map((r) => `${r.sel}{${r.body}}`).join('\n')) } };
}

/** one digest of a fingerprint (files + shell CSS) — each approval records the digest it approved */
export function fingerprintDigest(fp) {
  return sha(JSON.stringify({ files: FROZEN_FILES.map((f) => [f, fp.files?.[f] ?? null]), shellCss: fp.shellCss ?? null }));
}

export function readLock() { return JSON.parse(readFileSync(LOCK_PATH, 'utf8')); }

export function diffAgainstLock(current = computeFrozenShell(), lock = readLock()) {
  const changed = [];
  for (const f of FROZEN_FILES) if (lock.files?.[f] !== current.files[f]) changed.push(f);
  for (const f of Object.keys(lock.files ?? {})) if (!FROZEN_FILES.includes(f)) changed.push(f + ' (removed from the frozen list)');
  if (lock.shellCss?.sha256 !== current.shellCss.sha256 || lock.shellCss?.rules !== current.shellCss.rules) changed.push(STYLES_PATH + ' (shell rules)');
  return changed;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const ai = args.indexOf('--approve'); const ri = args.indexOf('--reason');
  const current = computeFrozenShell();
  if (ai < 0) {
    const changed = existsSync(LOCK_PATH) ? diffAgainstLock(current) : ['(no lock yet)'];
    console.log(JSON.stringify({ current, changed }, null, 2));
    process.exit(changed.length ? 1 : 0);
  }
  const approvedBy = args[ai + 1]; const reason = ri >= 0 ? args[ri + 1] : '';
  if (!approvedBy || !reason) { console.error('--approve "<owner name>" and --reason "<why>" are both required'); process.exit(2); }
  const prev = existsSync(LOCK_PATH) ? readLock() : { approvals: [] };
  const lock = { note: prev.note ?? 'Frozen POS top bar + sidebar (owner decision Nov 13 2026). Update ONLY via apps/pos-web/scripts/frozen-shell.mjs --approve (see its header).',
    ...current, approvals: [...(prev.approvals ?? []), { approvedBy, reason, at: new Date().toISOString(), fingerprint: fingerprintDigest(current), changed: existsSync(LOCK_PATH) ? diffAgainstLock(current, prev) : ['initial lock'] }] };
  writeFileSync(LOCK_PATH, JSON.stringify(lock, null, 2) + '\n');
  console.log('frozen-shell lock updated:', LOCK_PATH);
}
