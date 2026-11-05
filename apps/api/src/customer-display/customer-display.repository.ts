// customer-display.repository.ts — device-facing (kiosk) data access for the customer iPad display. A paired display has
// NO user session; it authenticates with the per-session PUBLIC TOKEN minted at session creation (sha256 hash stored on
// customer_display_sessions.public_token_hash). These reads are therefore looked up by session id (NOT tenant-scoped) and
// gated by the token in the service. Money math reuses the checkout dto helpers so totals never drift from the POS.
import { resolveCheckoutSettings, DEFAULT_CHECKOUT_SETTINGS, KyselyCheckoutRepository, type CheckoutSettings } from '@aipowersalon/checkout';
import type { CustomerDisplayCheckout } from '@aipowersalon/api-contracts/customer';
import { Kysely, sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { SALON_LOGO_CATEGORY } from '@aipowersalon/tenants';
import type { DisplayBrandingSource } from './customer-display-branding';
import { canMoveToSql } from '@aipowersalon/database';
import { DISPLAY_RECEIPT } from './display-receipt-lifecycle';

export interface DisplaySessionRow {
  id: string; tenantId: string; branchId: string | null; state: string; ticketId: string | null; ticketNumber: string | null; customerId: string | null;
  publicTokenHash: string | null; selectedTipCents: number; selectedTipType?: 'none' | 'percent' | 'custom'; selectedTipPercent?: number | null; subtotalCents: number; paymentMethod: string | null;
  expiresAt: string | null; closedAt: string | null; ticketStatus: string | null; lastPaymentStatus: string | null;
  /** When the latest payment attempt was created (an in-flight card charge older than the verify window shows
   *  'Verifying payment'), and when the ticket was paid (an old completed checkout is never re-shown). */
  lastPaymentAt?: string | null; ticketPaidAt?: string | null;
  /** The newest change time across the session, its ticket and its payments (ms) — the state's version (spec §101). */
  changedAtMs?: number;
  /** 23-inch spec §97: the receipt the customer chose on the display, and what happened (null until they choose). */
  receiptChoice?: 'sms' | 'email' | 'none' | null; receiptStatus?: 'sending' | 'sent' | 'skipped' | 'unavailable' | 'failed' | null;
}

/** §97: the salon's receipt behaviour for the display — ask on the display at all, and what to send when nobody chooses. */
export interface DisplayReceiptSettings { promptEnabled: boolean; defaultDelivery: string[] }

export interface DisplayDataPort {
  getSession(sessionId: string): Promise<DisplaySessionRow | null>;
  /** 23-inch spec §30–§39: the customer-safe checkout — built by the checkout module from the SAME ticket, totals and
   *  payments the POS reads. Every number the display shows comes from here; the display computes no money of its own. */
  checkoutProjection(tenantId: string, branchId: string | null, ticketId: string): Promise<CustomerDisplayCheckout | null>;
  salonName(tenantId: string): Promise<string>;
  /** 23-inch spec §13: the salon's name, the device branch's name, its Customer Display settings (branch row over the
   *  salon row) and its stored logo — for the display's header. */
  brandingSource(tenantId: string, branchId: string | null): Promise<DisplayBrandingSource>;
  customerFirstName(tenantId: string, customerId: string | null): Promise<string | undefined>;
  applyTip(sessionId: string, tipCents: number, subtotalCents: number, taxCents: number, surchargeCents: number, totalDueCents: number, meta?: { tipType: 'none' | 'percent' | 'custom'; tipPercent: number | null }): Promise<void>;
  setTicketTipFromDisplay(row: { tenantId: string; ticketId: string }, tipCents: number, meta: { tipType: 'none' | 'percent' | 'custom'; tipPercent: number | null }): Promise<void>;
  /** The customer's card/cash choice is the ticket's chosen method too — the POS and the display show one total. */
  setTicketMethodFromDisplay(row: { tenantId: string; ticketId: string }, method: 'card' | 'cash'): Promise<void>;
  applyMethod(sessionId: string, method: string, subtotalCents: number, taxCents: number, surchargeCents: number, totalDueCents: number): Promise<void>;
  resolveSettings(tenantId: string, branchId: string | null): Promise<CheckoutSettings>;
  markPaymentRequested(sessionId: string): Promise<void>;
  recordSatisfaction(tenantId: string, ticketId: string, rating: number): Promise<void>;
  // device-mode (mounted iPad authenticated by a per-device token)
  /** `maintenance`: the owner switched the display to maintenance (§85) — it shows a maintenance screen when idle. */
  deviceByToken(tokenHash: string): Promise<{ id: string; tenantId: string; branchId: string | null; maintenance?: boolean } | null>;
  currentSessionForDevice(deviceId: string): Promise<DisplaySessionRow | null>;
  /** End a checkout the customer has finished seeing: state 'completed', closed. Only an OPEN session moves; returns
   *  whether this call closed it (a second release is a no-op). */
  closeSessionCompleted(tenantId: string, sessionId: string): Promise<boolean>;
  /** §97: the receipt settings (the display's 'Ask for a receipt' switch; Receipts & Branding's default delivery). */
  receiptSettings(tenantId: string, branchId: string | null): Promise<DisplayReceiptSettings>;
  /** §97: record the customer's choice ONCE — false when a choice was already recorded (a double tap, two devices). */
  claimReceiptChoice(tenantId: string, sessionId: string, choice: 'sms' | 'email' | 'none', status: 'sending' | 'skipped'): Promise<boolean>;
  /** §97: what the delivery did. */
  finishReceipt(tenantId: string, sessionId: string, status: 'sent' | 'unavailable' | 'failed'): Promise<void>;
}

// DB-less fallback (returns nothing). The kiosk requires a real database; this keeps DI valid in offline/test contexts.
export class InMemoryDisplayRepository implements DisplayDataPort {
  async getSession(): Promise<DisplaySessionRow | null> { return null; }
  async checkoutProjection(): Promise<CustomerDisplayCheckout | null> { return null; }
  async salonName(): Promise<string> { return 'Salon'; }
  async brandingSource(): Promise<DisplayBrandingSource> { return { salonName: 'Salon', branchName: null, display: {}, logo: null }; }
  async customerFirstName(): Promise<string | undefined> { return undefined; }
  async applyTip(): Promise<void> { /* no-op */ }
  async setTicketTipFromDisplay(): Promise<void> { /* no-op */ }
  async setTicketMethodFromDisplay(): Promise<void> { /* no-op */ }
  async applyMethod(): Promise<void> { /* no-op */ }
  async resolveSettings(): Promise<CheckoutSettings> { return { ...DEFAULT_CHECKOUT_SETTINGS }; }
  async markPaymentRequested(): Promise<void> { /* no-op */ }
  async recordSatisfaction(): Promise<void> { /* no-op */ }
  async deviceByToken(): Promise<{ id: string; tenantId: string; branchId: string | null } | null> { return null; }
  async currentSessionForDevice(): Promise<DisplaySessionRow | null> { return null; }
  async closeSessionCompleted(): Promise<boolean> { return false; }
  async receiptSettings(): Promise<DisplayReceiptSettings> { return { promptEnabled: true, defaultDelivery: [] }; }
  async claimReceiptChoice(): Promise<boolean> { return false; }
  async finishReceipt(): Promise<void> { /* no-op */ }
}

const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const iso = (v: unknown): string | null => (v ? new Date(v as any).toISOString() : null);

export class KyselyDisplayRepository implements DisplayDataPort {
  constructor(private readonly db: Kysely<DB>) {}

  async getSession(sessionId: string): Promise<DisplaySessionRow | null> {
    const r: any = await this.db.selectFrom('customer_display_sessions')
      // Phase 12 #19: the columns the session view maps (public_token_hash is verified in-process by the service, never returned)
      .select(['id', 'tenant_id', 'branch_id', 'state', 'ticket_id', 'customer_id', 'public_token_hash', 'selected_tip_cents', 'selected_tip_type', 'selected_tip_percent',
        'subtotal_cents', 'payment_method', 'expires_at', 'closed_at', 'receipt_choice', 'receipt_status', 'created_at', 'updated_at'] as any)
      .where('id', '=', sessionId).executeTakeFirst().catch(() => undefined);
    if (!r) return null;
    // tickets has no ticket_number column; derive a short, stable order reference from the real ticket id.
    let ticketNumber = r.ticket_id ? '#' + String(r.ticket_id).replace(/-/g, '').slice(-4).toUpperCase() : null;
    let ticketStatus: string | null = null;
    let lastPaymentStatus: string | null = null;
    let lastPaymentAt: string | null = null;
    let ticketPaidAt: string | null = null;
    const ms = (v: unknown): number => { const t = v ? new Date(v as any).getTime() : 0; return Number.isFinite(t) ? t : 0; };
    let changedAtMs = Math.max(ms(r.updated_at), ms(r.created_at));
    if (r.ticket_id) {
      const tk: any = await this.db.selectFrom('tickets').select(['status', 'ticket_number', 'paid_at', 'updated_at']).where('id', '=', r.ticket_id).where('tenant_id', '=', r.tenant_id).executeTakeFirst().catch(() => undefined);
      ticketStatus = tk?.status ?? null;
      ticketPaidAt = iso(tk?.paid_at);
      changedAtMs = Math.max(changedAtMs, ms(tk?.updated_at), ms(tk?.paid_at));
      if (tk?.ticket_number) ticketNumber = '#' + tk.ticket_number; // prefer the human-friendly per-branch daily number
      // the latest payment attempt's outcome (authoritative, written by the POS pay path) lets the kiosk reflect a decline
      const pay: any = await this.db.selectFrom('payments').select(['status', 'created_at', 'updated_at']).where('ticket_id', '=', r.ticket_id).where('tenant_id', '=', r.tenant_id).orderBy('created_at', 'desc').limit(1).executeTakeFirst().catch(() => undefined);
      lastPaymentStatus = pay?.status ?? null;
      lastPaymentAt = iso(pay?.created_at);
      changedAtMs = Math.max(changedAtMs, ms(pay?.created_at), ms(pay?.updated_at));
    }
    return {
      id: r.id, tenantId: r.tenant_id, branchId: r.branch_id ?? null, state: r.state, ticketId: r.ticket_id ?? null, ticketNumber,
      customerId: r.customer_id ?? null, publicTokenHash: r.public_token_hash ?? null, selectedTipCents: n(r.selected_tip_cents), selectedTipType: (r.selected_tip_type as any) || 'none', selectedTipPercent: r.selected_tip_percent == null ? null : n(r.selected_tip_percent),
      subtotalCents: n(r.subtotal_cents), paymentMethod: r.payment_method ?? null, expiresAt: iso(r.expires_at), closedAt: iso(r.closed_at), ticketStatus, lastPaymentStatus,
      lastPaymentAt, ticketPaidAt, changedAtMs,
      receiptChoice: (r.receipt_choice ?? null) as DisplaySessionRow['receiptChoice'], receiptStatus: (r.receipt_status ?? null) as DisplaySessionRow['receiptStatus'],
    };
  }

  // The checkout module's own repository: the display reads exactly what the POS reads (one authoritative checkout).
  private checkoutRepo?: KyselyCheckoutRepository;
  async checkoutProjection(tenantId: string, branchId: string | null, ticketId: string): Promise<CustomerDisplayCheckout | null> {
    this.checkoutRepo ??= new KyselyCheckoutRepository(this.db);
    // Read-only context from the SESSION's tenant + branch (server-derived from the device) — never from the client.
    const ctx = { tenantId, branchId: branchId ?? '', userId: 'customer-display', role: 'CUSTOMER', permissions: [] } as Parameters<KyselyCheckoutRepository['customerDisplayCheckout']>[0];
    return this.checkoutRepo.customerDisplayCheckout(ctx, ticketId).catch(() => null);
  }

  async salonName(tenantId: string): Promise<string> {
    const r = await this.db.selectFrom('tenants').where('id', '=', tenantId).select(['display_name', 'legal_name']).executeTakeFirst().catch(() => undefined);
    return (r as any)?.display_name || (r as any)?.legal_name || 'Salon';
  }

  async brandingSource(tenantId: string, branchId: string | null): Promise<DisplayBrandingSource> {
    const json = (v: unknown): Record<string, unknown> => {
      let o: unknown = v;
      if (typeof o === 'string') { try { o = JSON.parse(o); } catch { return {}; } }
      return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
    };
    const [salonName, branch, rows] = await Promise.all([
      this.salonName(tenantId),
      branchId ? this.db.selectFrom('branches').select(['name']).where('tenant_id', '=', tenantId).where('id', '=', branchId).executeTakeFirst().catch(() => undefined) : Promise.resolve(undefined),
      this.db.selectFrom('tenant_settings').select(['branch_id', 'category', 'settings_json'])
        .where('tenant_id', '=', tenantId).where('category', 'in', ['customer-display-devices', SALON_LOGO_CATEGORY])
        .where((eb) => (branchId ? eb.or([eb('branch_id', '=', branchId), eb('branch_id', 'is', null)]) : eb('branch_id', 'is', null)))
        .execute().catch(() => [] as { branch_id: string | null; category: string; settings_json: unknown }[]),
    ]);
    // the salon's row first, then the branch's row over it (a branch may word its own screen)
    const ordered = [...rows].sort((a, b) => (a.branch_id === null ? 0 : 1) - (b.branch_id === null ? 0 : 1));
    let display: Record<string, unknown> = {}; let logo: Record<string, unknown> | null = null;
    for (const r of ordered) {
      if (r.category === 'customer-display-devices') display = { ...display, ...json(r.settings_json) };
      else if (r.category === SALON_LOGO_CATEGORY && r.branch_id === null) logo = json(r.settings_json);
    }
    return { salonName, branchName: (branch as any)?.name ?? null, display, logo };
  }

  async customerFirstName(tenantId: string, customerId: string | null): Promise<string | undefined> {
    if (!customerId) return undefined;
    const r = await this.db.selectFrom('customers').where('tenant_id', '=', tenantId).where('id', '=', customerId).select(['first_name']).executeTakeFirst().catch(() => undefined);
    const f = (r as any)?.first_name; return f || undefined;
  }

  resolveSettings(tenantId: string, branchId: string | null): Promise<CheckoutSettings> { return resolveCheckoutSettings(this.db, tenantId, branchId); }

  async markPaymentRequested(sessionId: string): Promise<void> {
    await this.db.updateTable('customer_display_sessions').set({ state: 'payment_processing', updated_at: new Date() as any } as any).where('id', '=', sessionId).execute().catch(() => {});
  }

  async recordSatisfaction(tenantId: string, ticketId: string, rating: number): Promise<void> {
    await this.db.updateTable('tickets').set({ satisfaction_rating: rating } as any).where('id', '=', ticketId).where('tenant_id', '=', tenantId).execute().catch(() => {});
  }

  async applyTip(sessionId: string, tipCents: number, subtotalCents: number, taxCents: number, surchargeCents: number, totalDueCents: number, meta?: { tipType: 'none' | 'percent' | 'custom'; tipPercent: number | null }): Promise<void> {
    await this.db.updateTable('customer_display_sessions').set({
      selected_tip_cents: tipCents, subtotal_cents: subtotalCents, tax_cents: taxCents, surcharge_cents: surchargeCents,
      total_due_cents: totalDueCents, state: 'tip_selected', updated_at: new Date() as any,
      ...(meta ? { selected_tip_type: meta.tipType, selected_tip_percent: meta.tipPercent } : {}),
    } as any).where('id', '=', sessionId).execute().catch(() => {});
  }

  /** The kiosk selection is authoritative for the ticket's tip provenance: write cents + true type at selection
   *  time (a paid ticket is never touched — payment finalization owns settled rows). */
  async setTicketTipFromDisplay(row: { tenantId: string; ticketId: string }, tipCents: number, meta: { tipType: 'none' | 'percent' | 'custom'; tipPercent: number | null }): Promise<void> {
    await this.db.updateTable('tickets').set({ tip_cents: tipCents, tip_type: meta.tipType, tip_percent: meta.tipPercent, locked_total_cents: null, updated_at: new Date() as any } as any)
      .where('id', '=', row.ticketId).where('tenant_id', '=', row.tenantId).where('status', '!=', 'paid').execute().catch(() => {});
  }

  async setTicketMethodFromDisplay(row: { tenantId: string; ticketId: string }, method: 'card' | 'cash'): Promise<void> {
    await this.db.updateTable('tickets').set({ chosen_payment_method: method, locked_total_cents: null, updated_at: new Date() as any } as any)
      .where('id', '=', row.ticketId).where('tenant_id', '=', row.tenantId).where('status', '!=', 'paid').execute().catch(() => {});
  }

  async applyMethod(sessionId: string, method: string, subtotalCents: number, taxCents: number, surchargeCents: number, totalDueCents: number): Promise<void> {
    await this.db.updateTable('customer_display_sessions').set({
      payment_method: method, subtotal_cents: subtotalCents, tax_cents: taxCents, surcharge_cents: surchargeCents,
      total_due_cents: totalDueCents, updated_at: new Date() as any,
    } as any).where('id', '=', sessionId).execute().catch(() => {});
  }

  async deviceByToken(tokenHash: string): Promise<{ id: string; tenantId: string; branchId: string | null; maintenance: boolean } | null> {
    // a 'pending' row (claimed, credential not collected) has no token; only a PAIRED display authenticates
    const r: any = await this.db.selectFrom('customer_display_devices').where('device_token_hash', '=', tokenHash).where('revoked_at', 'is', null).where('pairing_status', '=', 'paired')
      .select(['id', 'tenant_id', 'branch_id', 'maintenance_at']).executeTakeFirst().catch(() => undefined);
    return r ? { id: r.id, tenantId: r.tenant_id, branchId: r.branch_id ?? null, maintenance: !!r.maintenance_at } : null;
  }

  async currentSessionForDevice(deviceId: string): Promise<DisplaySessionRow | null> {
    const r: any = await this.db.selectFrom('customer_display_sessions').where('display_device_id', '=', deviceId)
      .where('state', 'not in', ['closed', 'disconnected']).where('closed_at', 'is', null).where((eb: any) => eb('expires_at', '>', sql`now()`))
      .orderBy('created_at', 'desc').select('id').executeTakeFirst().catch(() => undefined);
    return r?.id ? this.getSession(r.id) : null;
  }

  async closeSessionCompleted(tenantId: string, sessionId: string): Promise<boolean> {
    const res: any = await this.db.updateTable('customer_display_sessions')
      .set({ state: 'completed', closed_at: sql`now()`, updated_at: sql`now()` } as any)
      .where('tenant_id', '=', tenantId).where('id', '=', sessionId).where('closed_at', 'is', null).where('state', 'not in', ['closed', 'disconnected', 'completed'])
      .executeTakeFirst().catch(() => undefined);
    return Number(res?.numUpdatedRows ?? 0) > 0;
  }

  async receiptSettings(tenantId: string, branchId: string | null): Promise<DisplayReceiptSettings> {
    const json = (v: unknown): Record<string, unknown> => {
      let o: unknown = v;
      if (typeof o === 'string') { try { o = JSON.parse(o); } catch { return {}; } }
      return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
    };
    const rows = await this.db.selectFrom('tenant_settings').select(['branch_id', 'category', 'settings_json'])
      .where('tenant_id', '=', tenantId).where('category', 'in', ['customer-display-devices', 'receipts-branding'])
      .where((eb) => (branchId ? eb.or([eb('branch_id', '=', branchId), eb('branch_id', 'is', null)]) : eb('branch_id', 'is', null)))
      .execute().catch(() => [] as { branch_id: string | null; category: string; settings_json: unknown }[]);
    // the salon's row first, then the branch's over it — the same layering as the display's branding
    const ordered = [...rows].sort((a, b) => (a.branch_id === null ? 0 : 1) - (b.branch_id === null ? 0 : 1));
    let display: Record<string, unknown> = {}; let receipts: Record<string, unknown> = {};
    for (const r of ordered) {
      if (r.category === 'customer-display-devices') display = { ...display, ...json(r.settings_json) };
      else receipts = { ...receipts, ...json(r.settings_json) };
    }
    const dd = Array.isArray(receipts.defaultDelivery) ? (receipts.defaultDelivery as unknown[]).filter((x): x is string => typeof x === 'string') : ['SMS', 'Email'];
    // both default ON (settings.dto DEFAULTS: receiptPromptEnabled true, defaultDelivery ["SMS","Email"])
    return { promptEnabled: display.receiptPromptEnabled !== false, defaultDelivery: dd };
  }

  async claimReceiptChoice(tenantId: string, sessionId: string, choice: 'sms' | 'email' | 'none', status: 'sending' | 'skipped'): Promise<boolean> {
    const res: any = await this.db.updateTable('customer_display_sessions')
      .set({ receipt_choice: choice, receipt_status: status, receipt_at: sql`now()`, updated_at: sql`now()` } as any)
      .where('tenant_id', '=', tenantId).where('id', '=', sessionId).where('receipt_choice', 'is', null)
      .executeTakeFirst();
    return Number(res?.numUpdatedRows ?? 0) > 0;
  }

  async finishReceipt(tenantId: string, sessionId: string, status: 'sent' | 'unavailable' | 'failed'): Promise<void> {
    await this.db.updateTable('customer_display_sessions').set({ receipt_status: status, updated_at: sql`now()` } as any)
      .where('tenant_id', '=', tenantId).where('id', '=', sessionId).where('receipt_status', '=', 'sending').where(canMoveToSql(DISPLAY_RECEIPT, status) as any).execute();
  }
}
