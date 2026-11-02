#!/usr/bin/env node
// sync-brand.mjs — distribute the SINGLE-SOURCE brand assets into every app.
// Source of truth: /brand. For each web app it writes:
//   apps/<app>/public/brand/*          (logo, icons, favicon, brand-tokens.css, manifest)
//   (the brand COMPONENT and config are no longer copied: they live in packages/ui — Constitution 13 Phase 5)
// Mobile apps (Capacitor) also get their native adaptive icons refreshed from the real logo.
// Run after any change to /brand. Public assets must be copied (each app serves its own /brand/*); source code
// is shared through @aipowersalon/ui instead of copied.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRAND = path.join(root, 'brand');
const APPS = path.join(root, 'apps');

const PUBLIC_ASSETS = [
  'aipowersalon-logo.png', 'aipowersalon-logo.webp', 'favicon.ico', 'favicon-16.png', 'favicon-32.png',
  'apple-touch-icon.png', 'app-icon-192.png', 'app-icon-512.png', 'brand-tokens.css', 'manifest.webmanifest', 'splash-logo.png'
];
const ADAPTIVE = ['icon-only.png', 'icon-foreground.png', 'icon-background.png'];

async function exists(p){ try{ await fs.access(p); return true; }catch{ return false; } }
async function copy(src, dst){ await fs.mkdir(path.dirname(dst), { recursive:true }); await fs.copyFile(src, dst); }

const webApps = ['admin-web','pos-web','owner-web','tech-web','customer-web','customer-display','go-check-in-kiosk'];   // go-check-in-admin removed in Phase 15 (admin-web /check-in-devices)

let count = 0;
for (const app of webApps) {
  const appDir = path.join(APPS, app);
  if (!(await exists(appDir))) continue;
  // public/brand/*
  for (const a of PUBLIC_ASSETS) {
    if (await exists(path.join(BRAND, a))) { await copy(path.join(BRAND, a), path.join(appDir, 'public', 'brand', a)); count++; }
  }
  // refresh native adaptive icons from the REAL logo (retire placeholder "A" icons)
  if (await exists(path.join(appDir, 'assets'))) {
    for (const a of ADAPTIVE) { if (await exists(path.join(BRAND, a))) { await copy(path.join(BRAND, a), path.join(appDir, 'assets', a)); count++; } }
  }
}
console.log(`sync-brand: ${count} files written across ${webApps.length} apps`);
