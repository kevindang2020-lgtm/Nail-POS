// verify-brand-lock.mjs — guards the LOCKED AI PowerSalon sidebar palette.
// Fails (exit 1) if any app's sidebar loses the lock block or its exact values are changed.
// Run in CI / pre-commit:  node scripts/verify-brand-lock.mjs
import { readFileSync } from 'node:fs';

const APPS = ['pos-web', 'admin-web'];
// The locked values that MUST be present, verbatim, inside each app's .sidebar block.
const LOCKED = [
  '🔒 LOCKED — AI PowerSalon brand SIDEBAR palette',
  '--sidebar: #FBF7EF;',
  '--grad: linear-gradient(135deg, #E4BE7A, #BE9143);',
  '--g7: #BE9143;',
  '--gold: #BE9143;',
  '--gline: #D8BE86;',
  '--cream2: #F3E8D3;',
];

let failed = false;
for (const app of APPS) {
  const path = `apps/${app}/src/styles.css`;
  let css;
  try { css = readFileSync(path, 'utf8'); }
  catch { console.error(`✗ ${app}: styles.css not found`); failed = true; continue; }
  const missing = LOCKED.filter((v) => !css.includes(v));
  if (missing.length) {
    failed = true;
    console.error(`✗ ${app}: brand-lock VIOLATED — missing/changed:`);
    missing.forEach((m) => console.error(`    ${m}`));
  } else {
    console.log(`✓ ${app}: sidebar brand-lock intact`);
  }
}
if (failed) {
  console.error('\nBRAND LOCK FAILED — the sidebar palette was changed. Restore the locked values (see BRAND_SIDEBAR_LOCK.md).');
  process.exit(1);
}
console.log('\nBRAND_LOCK_OK — all sidebar palettes match the locked AI PowerSalon logo colors.');
