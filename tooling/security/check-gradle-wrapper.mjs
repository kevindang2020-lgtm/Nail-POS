#!/usr/bin/env node
// check-gradle-wrapper.mjs — Security Deep Scan A10/B15 (mandate §14, §146): the Android builds run a COMMITTED binary
// (gradle/wrapper/gradle-wrapper.jar) and download a Gradle distribution. A swapped wrapper jar in a future upload would
// execute on every developer machine and CI runner that builds the app; an unpinned distribution could be substituted.
//
//  • every apps/*/android/gradle/wrapper/gradle-wrapper.jar must hash to an OFFICIAL Gradle wrapper checksum listed
//    below (published at https://services.gradle.org/distributions/gradle-<v>-wrapper.jar.sha256 — verified Oct 23 2026);
//  • every gradle-wrapper.properties must carry distributionSha256Sum (Gradle then refuses a distribution that differs)
//    and an https services.gradle.org distributionUrl.
// CI additionally runs gradle/actions/wrapper-validation (mobile.yml) against Gradle's full published list.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** official wrapper-jar checksums, by Gradle version (add a line when upgrading — copy it from services.gradle.org) */
const OFFICIAL_WRAPPER_SHA256 = {
  '8.14.3': '7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172',
};
const ok = new Set(Object.values(OFFICIAL_WRAPPER_SHA256));
const problems = []; let checked = 0;
for (const app of readdirSync(join(ROOT, 'apps'))) {
  const dir = join(ROOT, 'apps', app, 'android', 'gradle', 'wrapper');
  if (!existsSync(dir)) continue;
  checked++;
  const jar = join(dir, 'gradle-wrapper.jar');
  if (existsSync(jar)) {
    const h = createHash('sha256').update(readFileSync(jar)).digest('hex');
    if (!ok.has(h)) problems.push(`apps/${app}: gradle-wrapper.jar sha256 ${h} is not an official Gradle wrapper checksum`);
  }
  const props = existsSync(join(dir, 'gradle-wrapper.properties')) ? readFileSync(join(dir, 'gradle-wrapper.properties'), 'utf8') : '';
  if (!/^distributionSha256Sum=[0-9a-f]{64}\s*$/m.test(props)) problems.push(`apps/${app}: gradle-wrapper.properties has no distributionSha256Sum`);
  if (!/^distributionUrl=https\\?:\/\/services\.gradle\.org\/distributions\/gradle-[\d.]+-(all|bin)\.zip\s*$/m.test(props)) problems.push(`apps/${app}: distributionUrl is not an https services.gradle.org distribution`);
}
if (problems.length) { console.error('❌ gradle-wrapper:'); for (const p of problems) console.error('   ' + p); process.exit(1); }
console.log(`✅ gradle-wrapper: ${checked} Android project(s) — official wrapper jar, pinned distribution checksum`);
