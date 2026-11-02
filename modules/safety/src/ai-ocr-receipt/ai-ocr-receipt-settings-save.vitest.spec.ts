// ai-ocr-receipt-settings-save.vitest.spec — deep-scan finding (Oct 22 2026): PUT /pos/ai-ocr-receipt/settings answered
// the effective config and saved NOTHING. The service now stores the layer (only known keys; the clamps stay forced) and
// answers the config that results from it.
import { describe, it, expect } from 'vitest';
import { AiOcrReceiptService } from './ai-ocr-receipt.service';
import type { SettingsRow } from './ai-ocr-receipt-settings';

const ctx = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: [] };
function make(saveResult = true) {
  const rows: SettingsRow[] = []; const audits: string[] = [];
  const settings: any = {
    async load() { return rows; },
    async save(_c: any, r: SettingsRow) { if (!saveResult) return false; const i = rows.findIndex((x) => x.level === r.level && x.branch_id === r.branch_id); if (i >= 0) rows[i] = r; else rows.push(r); return true; },
  };
  const audit: any = { async record(_c: any, a: string) { audits.push(a); } };
  return { svc: new AiOcrReceiptService({} as any, settings, {} as any, {} as any, {} as any, audit), rows, audits };
}

describe('AiOcrReceiptService.saveSettings', () => {
  it('stores the tenant layer and answers the new effective config (it used to save nothing)', async () => {
    const { svc, rows, audits } = make();
    const out = await svc.saveSettings(ctx, { level: 'tenant', enabled: true, config: { highAmountCents: 9000, bogus: 1, humanReviewRequired: false } });
    expect(out.config.highAmountCents).toBe(9000);
    expect(rows[0].config).toEqual({ highAmountCents: 9000 });          // unknown keys and the clamped invariants are not stored
    expect(out.config.humanReviewRequired).toBe(true);
    expect(audits).toContain('settings.saved');
  });
  it('a branch layer that turns the module off wins for that branch', async () => {
    const { svc } = make();
    const out = await svc.saveSettings(ctx, { level: 'branch', branchId: 'b1', enabled: false, config: null });
    expect(out.enabled).toBe(false);
  });
  it('refuses a bad level and a branch that is not this tenant\'s', async () => {
    await expect(make().svc.saveSettings(ctx, { level: 'platform' })).rejects.toMatchObject({ status: 400 });
    await expect(make(false).svc.saveSettings(ctx, { level: 'branch', branchId: 'other' })).rejects.toMatchObject({ status: 404 });
  });
});
