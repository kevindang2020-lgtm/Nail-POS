// skip-line-settings.pgtest — the Skip-the-Line settings read, against the real schema AND against a failing
// database, because the finding here is about which way it fails.
//
// The same fallback used to serve two different facts: "this salon never configured Skip-the-Line" and "the
// settings query threw". The product defaults have featureEnabled AND allowCashToTechnician set to TRUE, so a
// query error silently RE-ENABLED cash collection by technicians for a salon that had switched it off.
//
// Now: no row → defaults (unchanged); error → fail CLOSED. And the write path reads strictly, so a transient
// read error during an update ABORTS the update instead of persisting the fail-closed values.
import { describe, it, expect, beforeAll } from 'vitest';
import { SkipLineCheckoutRepository } from './skip-line-checkout.repository';
import { DEFAULT_SKIP_LINE_SETTINGS } from './skip-line-checkout.dto';
// Shared, cached migrated schema — see @aipowersalon/testing (packages/testing/src/pgtest-schema.mjs) (built once, reused by every pgtest).
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

const T = 'b3b3b3b3-0000-4000-8000-000000000001';
const UNCONFIGURED = 'b3b3b3b3-0000-4000-8000-000000000002';
let repo: SkipLineCheckoutRepository;
let realDb: any;

/**
 * A TRANSIENT failure: the settings READ throws, but WRITES still succeed. This is the case that matters for the
 * write path — a database that fails everything also fails the write, so an update would reject regardless and
 * prove nothing. An earlier version of this file used only the fully-broken DB, and a mutation that reverted the
 * update path to the fail-closed reader survived for exactly that reason.
 */
// Fails the FIRST read of the settings table only. updateSettings reads that table twice — once for the
// current values, once as an existence check before choosing UPDATE vs INSERT — and a proxy that failed every
// read also failed the existence check, so the update rejected no matter which reader it used. That made the
// mutation survive a second time. One failure, then recovery, is what "transient" actually means.
const readFailsWriteWorks = () => { let failed = false; return new Proxy(realDb, {
  get(target, prop) {
    if (prop === 'selectFrom') return (table: string) => {
      if (table === 'skip_line_checkout_settings' && !failed) { failed = true; throw new Error('transient read failure'); }
      return target.selectFrom(table);
    };
    const v = target[prop];
    return typeof v === 'function' ? v.bind(target) : v;
  },
}); };

/** A database whose every query throws — the failure this whole file is about. */
const brokenDb = () => ({
  selectFrom: () => ({ selectAll: () => ({ where: () => ({ executeTakeFirst: async () => { throw new Error('connection reset'); } }) }) }),
}) as never;

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
    VALUES ('${T}', 'Skip Salon LLC', 'Skip Salon', 'skip-salon', 'SKIP1', 'active') ON CONFLICT DO NOTHING;
  `);
  // A salon that has DISABLED both controls — the case the old fallback silently reversed.
  await pg.exec(`
    INSERT INTO skip_line_checkout_settings (tenant_id, feature_enabled, allow_cash_to_technician)
    VALUES ('${T}', false, false);
  `);
  realDb = kyselyFor(pg);
  repo = new SkipLineCheckoutRepository(realDb as never);
});

describe('stored settings are honoured', () => {
  it('a salon that disabled Skip-the-Line reads it back as DISABLED', async () => {
    expect((await repo.getSettings(T)).featureEnabled).toBe(false);
  });

  it('a salon that disabled cash-to-technician reads it back as DISABLED', async () => {
    expect((await repo.getSettings(T)).allowCashToTechnician).toBe(false);
  });
});

describe('"never configured" still gets the product defaults — unchanged behaviour', () => {
  it('no row → the defaults, exactly', async () => {
    expect(await repo.getSettings(UNCONFIGURED)).toEqual(DEFAULT_SKIP_LINE_SETTINGS);
  });
});

describe('a QUERY ERROR fails closed, and is no longer mistaken for "never configured"', () => {
  it('the feature is OFF on error', async () => {
    const s = await new SkipLineCheckoutRepository(brokenDb()).getSettings(T);
    expect(s.featureEnabled).toBe(false);
  });

  it('cash-to-technician is OFF on error — the control the old fallback silently re-enabled', async () => {
    const s = await new SkipLineCheckoutRepository(brokenDb()).getSettings(T);
    expect(s.allowCashToTechnician).toBe(false);
  });

  it('the error result is DIFFERENT from the no-row result — the two facts no longer collapse', async () => {
    const onError = await new SkipLineCheckoutRepository(brokenDb()).getSettings(T);
    expect(onError).not.toEqual(DEFAULT_SKIP_LINE_SETTINGS);
  });
});

describe('the write path never persists fail-closed values', () => {
  it('an update during a read error THROWS instead of writing', async () => {
    await expect(new SkipLineCheckoutRepository(brokenDb()).updateSettings(T, { autoSendPromptOnServiceDone: false }))
      .rejects.toThrow();
  });

  it('THE CASE THAT MATTERS: a transient read failure must not PERSIST fail-closed values', async () => {
    // Enable both controls first, so persisting the fail-closed values would visibly switch them OFF.
    await repo.updateSettings(T, { featureEnabled: true, allowCashToTechnician: true });

    await expect(new SkipLineCheckoutRepository(readFailsWriteWorks() as never)
      .updateSettings(T, { autoSendPromptOnServiceDone: false })).rejects.toThrow();

    // The salon's real choices survive the failed update untouched.
    const after = await repo.getSettings(T);
    expect(after.featureEnabled).toBe(true);
    expect(after.allowCashToTechnician).toBe(true);

    await repo.updateSettings(T, { featureEnabled: false, allowCashToTechnician: false });   // restore for later tests
  });

  it('a normal update merges onto the TRUE stored values, not onto defaults', async () => {
    const after = await repo.updateSettings(T, { autoSendPromptOnServiceDone: false });
    expect(after.featureEnabled).toBe(false);          // preserved from storage
    expect(after.allowCashToTechnician).toBe(false);   // preserved from storage
    expect(after.autoSendPromptOnServiceDone).toBe(false);
  });
});
