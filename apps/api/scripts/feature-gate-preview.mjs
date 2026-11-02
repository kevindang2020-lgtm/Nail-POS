#!/usr/bin/env node
// feature-gate-preview.mjs — BUILD_PLAN Phase 12 (#13): BEFORE setting FEATURE_ENTITLEMENT_ENFORCEMENT=enforce, list
// every salon that would LOSE a plan-gated feature it can open today, read from the live data with the guard's own
// decision (loadFeatureFacts + decideFeature — the compiled @aipowersalon/platform and @aipowersalon/permissions).
//
//   DATABASE_URL=… node apps/api/scripts/feature-gate-preview.mjs          a table: salon · plan · feature · reason · upgrade
//   DATABASE_URL=… node apps/api/scripts/feature-gate-preview.mjs --json   the raw rows
//
// Read-only. Stops without DATABASE_URL. Nobody's access changes by running it.
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('feature-gate-preview: DATABASE_URL is required (a migrated database)'); process.exit(1); }
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const { Kysely, PostgresDialect } = require('kysely');
const { decideFeature, PLAN_FEATURE_ROUTES } = require(join(REPO, 'packages/permissions/dist/index.js'));
const { loadFeatureFacts } = require(join(REPO, 'modules/platform/dist/super-admin-plans/plan-feature-source.js'));
const { FeatureRegistry } = require(join(REPO, 'modules/platform/dist/super-admin-plans/feature-registry.js'));

const db = new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 2 }) }) });
try {
  const reg = new FeatureRegistry(db);
  const tenants = (await db.selectFrom('tenants').select(['id', 'display_name', 'legal_name']).where('status', 'is distinct from', 'archived').orderBy('display_name').execute());
  const rows = [];
  for (const t of tenants) {
    const plan = (await db.selectFrom('tenant_subscriptions').select('plan').where('tenant_id', '=', t.id).where(({ fn }) => fn('lower', ['status']), '=', 'active').limit(1).executeTakeFirst())?.plan ?? null;
    for (const feature of Object.keys(PLAN_FEATURE_ROUTES)) {
      const d = decideFeature(await loadFeatureFacts(db, t.id, feature, reg));
      if (!d.allowed) rows.push({ tenantId: t.id, salon: t.display_name || t.legal_name, plan, feature, reason: d.reason, upgradeTo: d.upgradeTo });
    }
  }
  if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
  else {
    console.log(`feature-gate-preview: ${tenants.length} salons × ${Object.keys(PLAN_FEATURE_ROUTES).length} plan-gated features — ${rows.length} would be refused under enforce\n`);
    for (const r of rows) console.log(`${r.salon} (${r.tenantId})  plan=${r.plan ?? '—'}  ${r.feature}  ${r.reason}${r.upgradeTo ? `  → ${r.upgradeTo}` : ''}`);
  }
} finally { await db.destroy(); }
