// build-info.ts — Constitution 11 §6, §68–69, §165, §252: the release marker.
//
// Every log line and the metrics registry carry WHICH BUILD produced them, so "error rate rose right after 4.2.8"
// is answerable (§69, §165). Nothing here is secret (§252: non-secret configuration).
//
// ON RAILWAY IT TURNS ON BY ITSELF. AIPowerSalon deploys on Railway (railway.json, Dockerfile), and Railway injects
// RAILWAY_GIT_COMMIT_SHA, RAILWAY_DEPLOYMENT_ID and RAILWAY_ENVIRONMENT_NAME into every deployment. So the commit and
// deployment come from Railway with nothing to configure, and the version is package.json's (shipped in the image
// beside dist/). Explicit APP_VERSION / GIT_SHA still win if a pipeline sets them. When nothing is available the build
// reports 'unknown' — never a guess.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registry } from './metrics';

export interface BuildInfo { version: string; commit: string; deployment: string; environment: string; startedAt: string }

const short = (v: unknown, max: number) => String(v ?? '').trim().replace(/[^\w.+-]/g, '').slice(0, max) || 'unknown';

/** package.json's version, read once at startup from the working directory (the image ships it). Never throws. */
export function packageVersion(dir = process.cwd()): string | undefined {
  try { return String(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version || '') || undefined; } catch { return undefined; }
}

export function buildInfoFrom(env: Record<string, string | undefined>, startedAt = new Date(), pkgVersion?: string): BuildInfo {
  const commit = short(env.GIT_SHA || env.COMMIT_SHA || env.RAILWAY_GIT_COMMIT_SHA, 40);
  const base = env.APP_VERSION || env.npm_package_version || pkgVersion;
  return {
    // package.json alone says 1.0.0 for every release; with the commit appended, two deploys are never the same label.
    version: short(env.APP_VERSION ? env.APP_VERSION : base && commit !== 'unknown' ? `${base}+${commit.slice(0, 7)}` : base, 40),
    commit,
    deployment: short(env.RAILWAY_DEPLOYMENT_ID, 40),
    environment: short(env.RAILWAY_ENVIRONMENT_NAME || env.NODE_ENV || 'development', 20),
    startedAt: startedAt.toISOString(),
  };
}

export const BUILD: BuildInfo = buildInfoFrom(process.env, new Date(), packageVersion());

// §69: a constant-1 gauge whose LABELS are the marker — the standard way a dashboard draws a release line.
export const buildInfoGauge = registry.gauge('aipowersalon_build_info', 'Release marker: 1, labelled by version and commit', ['version', 'commit']);
buildInfoGauge.set(1, { version: BUILD.version, commit: BUILD.commit });
