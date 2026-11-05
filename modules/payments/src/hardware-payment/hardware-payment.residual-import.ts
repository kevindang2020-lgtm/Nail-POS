// hardware-payment.residual-import.ts — §12 FiservResidualImportService. Lands per-tenant monthly card volume into
// hardware_card_volume; the monthly job reads it. The live Fiserv residual-report fetch (creds/network) plugs into
// importFromFiserv() — until then, volumes are loaded via importVolume() (ops/import endpoint) or the manual API.
import { Injectable, Inject, Optional } from '@nestjs/common';
import { HW_REPO } from './hardware-payment.service';
import type { HardwarePaymentDataPort } from './hardware-payment.repository';
import { InMemoryHardwarePaymentRepository } from './hardware-payment.repository';

@Injectable()
export class FiservResidualImportService {
  constructor(@Optional() @Inject(HW_REPO) private readonly repo: HardwarePaymentDataPort = new InMemoryHardwarePaymentRepository()) {}

  /** Land a tenant's finalized monthly card volume (cents). source defaults to 'manual'. */
  async importVolume(tenantId: string, billingMonth: string, cardVolumeCents: number, source = 'manual'): Promise<{ ok: true; tenantId: string; billingMonth: string; cardVolumeCents: number }> {
    const cents = Math.max(0, Math.trunc(Number(cardVolumeCents) || 0));
    await this.repo.upsertCardVolume(tenantId, billingMonth, cents, source);
    return { ok: true, tenantId, billingMonth, cardVolumeCents: cents };
  }
  async getVolume(tenantId: string, billingMonth: string): Promise<number | null> { return this.repo.getCardVolume(tenantId, billingMonth); }

  /**
   * Pull a month of residual/funding volume from the live Fiserv residual report and land it via importVolume().
   * Configured by env: FISERV_RESIDUAL_URL (required) and FISERV_RESIDUAL_AUTH (optional, sent as the Authorization
   * header, e.g. 'Bearer …' or 'Basic …'). The report is expected to return a JSON array (or { rows } / { residuals })
   * of objects carrying a tenant id (tenantId | tenant_id | merchantTenantId) and a card volume in cents
   * (cardVolumeCents | card_volume_cents) or dollars (cardVolume | card_volume). Returns { configured:false } when the
   * URL isn't set so callers can no-op cleanly. Network/transport injected for testing.
   */
  async importFromFiserv(billingMonth: string, fetchImpl: typeof fetch = fetch): Promise<{ imported: number; configured: boolean; skipped: number }> {
    const url = process.env.FISERV_RESIDUAL_URL;
    if (!url) return { imported: 0, configured: false, skipped: 0 };
    const auth = process.env.FISERV_RESIDUAL_AUTH;
    const sep = url.includes('?') ? '&' : '?';
    const res = await fetchImpl(`${url}${sep}month=${encodeURIComponent(billingMonth)}`, { headers: auth ? { authorization: auth } : {} } as any);
    if (!res.ok) throw new Error(`Fiserv residual fetch failed: HTTP ${res.status}`);
    const data: any = await res.json();
    const rows: any[] = Array.isArray(data) ? data : (data?.rows ?? data?.residuals ?? []);
    let imported = 0, skipped = 0;
    for (const r of rows) {
      const tenantId = r.tenantId ?? r.tenant_id ?? r.merchantTenantId;
      const cents = r.cardVolumeCents ?? r.card_volume_cents ?? ((r.cardVolume ?? r.card_volume) != null ? Math.round(Number(r.cardVolume ?? r.card_volume) * 100) : null);
      if (!tenantId || cents == null || Number.isNaN(Number(cents))) { skipped++; continue; }
      await this.importVolume(String(tenantId), billingMonth, Number(cents), 'fiserv_residual');
      imported++;
    }
    return { imported, configured: true, skipped };
  }
}
