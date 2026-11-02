// settings.a2p.kysely.ts — the POS A2P status read (GET /pos/settings/notifications-reminders/a2p-status) from the REAL
// registration record, tenant_a2p_registrations (migration 312, driven from Super Admin, modules/communications/src/
// tenant-a2p). Before (Phone & Messaging guide, Oct 30 2026) the route read an in-memory map that defaulted to the
// platform brand "AIPowerSalon" and, after a POS "register", reported "pending" for something nobody had submitted.
//
// PM-03 (Four-Module Completion Guide §7.1, Oct 30 2026 round 2): a submission is NOT approval. `registered` only when
// the PROVIDER confirmed both the brand and the campaign as approved in a fresh read (tenant_messaging_registration_
// snapshots, migration 725, written by the communications registration sync); a record that merely says APPROVED with
// no provider confirmation stays `pending`. `rejected` for a failed / rejected / suspended step (record or provider);
// `pending` while anything was submitted; else `not_registered`. The brand shown is the salon's own business name from
// the registration inputs — never the platform's name — or '' when none was captured.
//
// (Reads communications-owned tables read-only, like customers/retention.repository.ts; the tenants module does not
// import the communications module.)
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { A2PStatus } from './settings.integrations';

export interface A2pStatusView { senderBrand: string; a2pStatus: A2PStatus; brandStatus: string | null; campaignStatus: string | null; lastUpdatedAt: string | null; source: 'tenant_a2p_registrations';
  providerVerified: boolean; lastProviderCheckAt: string | null }
export interface A2pStatusReaderPort { read(tenantId: string): Promise<A2pStatusView> }
/** the provider's own read of one item (latest snapshot) */
export interface ProviderItem { state: string; verified: boolean; errorClass: string | null; checkedAt: Date }
/** a provider confirmation older than this no longer counts — the same window the readiness uses (registration-model.ts) */
export const PROVIDER_CONFIRMATION_FRESH_MS = 72 * 3600 * 1000;

const up = (v: unknown) => String(v ?? '').toUpperCase();
export function a2pStatusOf(r: { brand_status?: unknown; campaign_status?: unknown; status?: unknown } | null | undefined,
  provider: { brand?: ProviderItem | null; campaign?: ProviderItem | null } | null = null, now: Date = new Date()): A2PStatus {
  const confirmed = (x: ProviderItem | null | undefined) => !!x && x.verified && !x.errorClass && now.getTime() - x.checkedAt.getTime() <= PROVIDER_CONFIRMATION_FRESH_MS;
  const pb = provider?.brand, pc = provider?.campaign;
  const providerBad = [pb, pc].some((x) => confirmed(x) && (x!.state === 'rejected' || x!.state === 'suspended'));
  if (providerBad) return 'rejected';
  if (confirmed(pb) && confirmed(pc) && pb!.state === 'approved' && pc!.state === 'approved') return 'registered';
  if (!r) return 'not_registered';
  const b = up(r.brand_status), c = up(r.campaign_status), s = String(r.status ?? '');
  const bad = (x: string) => x === 'FAILED' || x === 'REJECTED' || x === 'SUSPENDED';
  if (bad(b) || bad(c) || s === 'failed') return 'rejected';
  if (b || c || (s && s !== 'not_started')) return 'pending';   // submitted (even "approved" in the record) — awaiting provider confirmation
  return 'not_registered';
}

export class KyselyA2pStatusReader implements A2pStatusReaderPort {
  constructor(private readonly db: AppDatabase) {}
  async read(tenantId: string): Promise<A2pStatusView> {
    const res: any = await sql`SELECT a.brand_status, a.campaign_status, a.status, a.updated_at,
        COALESCE(a.business_info->>'businessName', a.business_info->>'business_name', a.business_info->>'legalName') AS brand_name
      FROM tenant_a2p_registrations a WHERE a.tenant_id = ${tenantId} ORDER BY a.updated_at DESC NULLS LAST LIMIT 1`.execute(this.db);
    const snaps: any = await sql`SELECT DISTINCT ON (s.item_kind) s.item_kind, s.normalized_state, s.verified, s.error_class, s.checked_at
      FROM tenant_messaging_registration_snapshots s WHERE s.tenant_id = ${tenantId} AND s.item_kind IN ('brand', 'campaign')
      ORDER BY s.item_kind, s.checked_at DESC, s.id DESC`.execute(this.db);
    const item = (k: string): ProviderItem | null => { const x = (snaps.rows ?? []).find((y: any) => y.item_kind === k); return x ? { state: String(x.normalized_state), verified: !!x.verified, errorClass: x.error_class ?? null, checkedAt: new Date(x.checked_at) } : null; };
    const provider = { brand: item('brand'), campaign: item('campaign') };
    const r = res.rows?.[0] ?? null;
    const status = a2pStatusOf(r, provider);
    const checks = [provider.brand?.checkedAt, provider.campaign?.checkedAt].filter(Boolean).map((d) => (d as Date).getTime());
    return { senderBrand: r?.brand_name ? String(r.brand_name).slice(0, 120) : '', a2pStatus: status, brandStatus: r?.brand_status ?? null, campaignStatus: r?.campaign_status ?? null,
      lastUpdatedAt: r?.updated_at ? new Date(r.updated_at).toISOString() : null, source: 'tenant_a2p_registrations',
      providerVerified: status === 'registered', lastProviderCheckAt: checks.length ? new Date(Math.max(...checks)).toISOString() : null };
  }
}
