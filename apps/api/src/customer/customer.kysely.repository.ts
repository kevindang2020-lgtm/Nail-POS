import { storedDateString } from '@aipowersalon/customers';
import { branchTimeZone } from '@aipowersalon/database';
import { businessDate } from '@aipowersalon/date-time';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter } from '@aipowersalon/events';
import { isCheckInEligible } from '@aipowersalon/api-contracts';
import { secureString } from '@aipowersalon/security';
import { readAppFlag, normalizePhone, applyLoyaltyEntry, lockLoyaltyCustomer } from '@aipowersalon/customers';
// customer.kysely.repository.ts — Postgres (Kysely) CustomerDataPort. Resolves the customer from the session via the
// new customers.user_id link, then reads home pieces / appointments / receipts / loyalty / active-service and writes
// profile updates — all tenant-scoped. Loyalty tiers come from LOYALTY_TIERS_JSON (sensible default otherwise). Values
// are server-truth; nothing is fabricated. Validated against a live schema via scripts/db-smoke.ts.
import { Kysely, sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { maskFromLast4 } from '@aipowersalon/gift-cards';
import { recordAppointmentChanges } from '@aipowersalon/appointments';
import type { HomeSalon, SetHomeSalonResult, CustomerContext, CustomerDataPort, CustomerHomeRaw } from './customer.repository';
import type { CustomerNextAppointment, CustomerAppointmentItem, CustomerReceiptItem, LoyaltyTierConfig, UpdateCustomerProfileRequest , CustomerSalonInfo, CustomerNotification, CustomerGiftCard, GiftCardClaimInput, GiftCardClaimRow, GiftCardClaimResult, CustomerAddress, CreateAddressRequest, CustomerDeal, CustomerProfile, CustomerCheckInResult, RewardsView, RedeemResult} from './customer.dto';
import type { ActiveServiceRaw } from './customer-core';
import { QUEUE_ACTIVE, type CustomerQueueRaw } from './customer-queue';
import { buildMediaUrl } from '@aipowersalon/media';
import { canMoveToSql } from '@aipowersalon/database';
import { GIFT_CARD } from '@aipowersalon/gift-cards';
import { APPOINTMENT } from '@aipowersalon/appointments';

const iso = (v: unknown): string => (v == null ? '' : v instanceof Date ? v.toISOString() : new Date(v as string).toISOString());
// pos_tech_appointments.services is a JSONB array; its element shape is inconsistent across booking sources
// (booking writes {serviceName}, customer-booking writes {name}), so read both keys.
const apptServiceId = (services: any): string | undefined => {
  try { const a = typeof services === 'string' ? JSON.parse(services) : services; return Array.isArray(a) && a[0]?.serviceId ? String(a[0].serviceId) : undefined; } catch { return undefined; }
};
const apptServiceName = (services: any): string => {
  const arr = Array.isArray(services) ? services : (typeof services === 'string' ? (() => { try { return JSON.parse(services); } catch { return []; } })() : []);
  const first = (arr && arr[0]) || {};
  return first.serviceName || first.name || '';
};
const SERVING = ['serving', 'nearly_finished'];
const APPT_UPCOMING = ['confirmed', 'arrived', 'checked_in', 'waiting', 'assigned', 'booked'];
const DONE = ['done', 'completed', 'service_done', 'paid', 'checked_out'];

function defaultTiers(): LoyaltyTierConfig[] {
  return [{ tier: 'Bronze', threshold: 0 }, { tier: 'Silver', threshold: 500 }, { tier: 'Gold', threshold: 1500 }, { tier: 'Platinum', threshold: 4000 }];
}
function parseTiers(): LoyaltyTierConfig[] {
  const raw = process.env.LOYALTY_TIERS_JSON;
  if (!raw) return defaultTiers();
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.every((t) => t && typeof t.tier === 'string' && typeof t.threshold === 'number')) return arr as LoyaltyTierConfig[];
  } catch { /* fall through to default */ }
  return defaultTiers();
}

export class KyselyCustomerRepository implements CustomerDataPort {
  constructor(private readonly db: Kysely<DB>, private readonly outbox?: OutboxWriter) {}

  async serviceProgressEnabled(ctx: CustomerContext): Promise<boolean> {
    return readAppFlag(this.db, ctx.tenantId, 'customer_service_progress');
  }

  async resolveCustomerId(ctx: CustomerContext): Promise<string | null> {
    const row = await this.db.selectFrom('customers').select('id')
      .where('tenant_id', '=', ctx.tenantId).where('user_id', '=', ctx.userId).where('archived_at', 'is', null)
      .executeTakeFirst();
    return row?.id ?? null;
  }

  async getLoyaltyConfig(): Promise<LoyaltyTierConfig[]> { return parseTiers(); }

  async loyaltyPoints(ctx: CustomerContext, customerId: string): Promise<number> {
    const row = await this.db.selectFrom('customer_loyalty_profiles').select('points_balance')
      .where('tenant_id', '=', ctx.tenantId).where('customer_id', '=', customerId).executeTakeFirst();
    return row?.points_balance ?? 0;
  }

  private async techNames(ctx: CustomerContext, techIds: string[]): Promise<Map<string, string>> {
    const m = new Map<string, string>();
    const ids = techIds.filter(Boolean);
    if (!ids.length) return m;
    const rows = await this.db.selectFrom('technicians').select(['id', 'full_name'])
      .where('tenant_id', '=', ctx.tenantId).where('id', 'in', ids).execute();
    for (const r of rows) m.set(r.id, r.full_name);
    return m;
  }

  async appointments(ctx: CustomerContext, customerId: string): Promise<CustomerAppointmentItem[]> {
    const startTs = sql<string>`(appt_date + start_time::time)`;
    const rows = await this.db.selectFrom('pos_tech_appointments').select(['id', 'technician_id', 'branch_id', 'duration_minutes', startTs.as('start_ts'), 'status', 'services'])
      .where('tenant_id', '=', ctx.tenantId).where('customer_id', '=', customerId)
      .orderBy('appt_date', 'desc').orderBy('start_time', 'desc').limit(50).execute();
    const techs = await this.techNames(ctx, rows.map((r) => r.technician_id).filter((x): x is string => !!x));
    const branches = await this.branchNames(ctx, rows.map((r) => r.branch_id).filter((x): x is string => !!x));
    return rows.map((r) => ({ appointmentId: r.id, serviceName: apptServiceName(r.services), startTime: iso(r.start_ts), status: r.status, technicianName: r.technician_id ? techs.get(r.technician_id) : undefined, branchName: r.branch_id ? branches.get(r.branch_id) : undefined, serviceId: apptServiceId(r.services), technicianId: r.technician_id ?? undefined, durationMinutes: Number(r.duration_minutes) || undefined }));
  }

  private async branchNames(ctx: CustomerContext, branchIds: string[]): Promise<Map<string, string>> {
    const m = new Map<string, string>();
    const ids = Array.from(new Set(branchIds.filter(Boolean)));
    if (!ids.length) return m;
    const rows = await this.db.selectFrom('branches').select(['id', 'name'])
      .where('tenant_id', '=', ctx.tenantId).where('id', 'in', ids).execute();
    for (const r of rows) m.set(r.id, r.name);
    return m;
  }

  private async nextAppointment(ctx: CustomerContext, customerId: string): Promise<CustomerNextAppointment | undefined> {
    const startTs = sql<string>`(appt_date + start_time::time)`;
    const row = await this.db.selectFrom('pos_tech_appointments').select(['id', 'technician_id', startTs.as('start_ts'), 'status', 'services'])
      .where('tenant_id', '=', ctx.tenantId).where('customer_id', '=', customerId)
      .where(sql<boolean>`(appt_date + start_time::time) >= now()`).where('status', 'in', APPT_UPCOMING)
      .orderBy('appt_date', 'asc').orderBy('start_time', 'asc').executeTakeFirst();
    if (!row) return undefined;
    const techs = await this.techNames(ctx, row.technician_id ? [row.technician_id] : []);
    return { appointmentId: row.id, serviceName: apptServiceName(row.services), startTime: iso(row.start_ts), status: row.status, technicianName: row.technician_id ? techs.get(row.technician_id) : undefined };
  }

  async activeService(ctx: CustomerContext, customerId: string): Promise<ActiveServiceRaw | null> {
    const t = await this.db.selectFrom('tickets').select(['id', 'status', 'serving_started_at', 'accepted_at'])
      .where('tenant_id', '=', ctx.tenantId).where('customer_id', '=', customerId).where('status', 'in', SERVING)
      .orderBy('serving_started_at', 'desc').executeTakeFirst();
    if (!t) return null;
    const line = await this.db.selectFrom('ticket_service_lines').select(['service_name_snapshot', 'duration_minutes_snapshot', 'created_at'])
      .where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', t.id).orderBy('created_at', 'asc').executeTakeFirst();
    return { ticketId: t.id, serviceName: line?.service_name_snapshot ?? '', status: t.status, startedAt: iso(t.serving_started_at ?? t.accepted_at), durationMinutes: line?.duration_minutes_snapshot ?? 0 };
  }

  async receipts(ctx: CustomerContext, customerId: string): Promise<CustomerReceiptItem[]> {
    const rows = await this.db.selectFrom('receipts')
      .innerJoin('tickets', 'tickets.id', 'receipts.ticket_id')
      .select(['receipts.id as id', 'receipts.total_cents as total_cents', 'receipts.created_at as created_at', 'receipts.emailed_to as emailed_to'])
      .where('receipts.tenant_id', '=', ctx.tenantId).where('tickets.customer_id', '=', customerId)
      .orderBy('receipts.created_at', 'desc').limit(50).execute();
    return rows.map((r) => ({ receiptId: r.id, date: iso(r.created_at), totalCents: r.total_cents, channel: r.emailed_to ? 'email' : undefined }));
  }

  async homeRaw(ctx: CustomerContext, customerId: string): Promise<CustomerHomeRaw> {
    const cust = await this.db.selectFrom('customers').select(['full_name', 'avatar_url']).where('tenant_id', '=', ctx.tenantId).where('id', '=', customerId).executeTakeFirst();
    const [points, nextAppointment, active] = await Promise.all([
      this.loyaltyPoints(ctx, customerId), this.nextAppointment(ctx, customerId), this.activeService(ctx, customerId),
    ]);
    const visits = await this.db.selectFrom('tickets').select((eb) => eb.fn.count<string>('id').as('c'))
      .where('tenant_id', '=', ctx.tenantId).where('customer_id', '=', customerId).where('status', 'in', DONE).executeTakeFirst();
    return { customerName: cust?.full_name ?? '', avatarUrl: cust?.avatar_url ? buildMediaUrl(cust.avatar_url) : null, points, nextAppointment, activeService: active ?? undefined, recentVisitsCount: Number(visits?.c ?? 0) };
  }

  async updateProfile(ctx: CustomerContext, customerId: string, patch: UpdateCustomerProfileRequest): Promise<void> {
    const set: Record<string, unknown> = { updated_at: new Date() };
    // ── THE PHONE IS NOT CHANGEABLE HERE. ──────────────────────────────────────────────────────────────
    //
    // This wrote `normalized_phone` straight from a customer-supplied string, and it was the SAME hole the POS had
    // -- reached from the other side:
    //
    //   * `replace(/\D+/g, '')` strips the "+" as well. "+15551234567" became "15551234567" -- NOT E.164, and not a
    //     number Twilio can send to. So the "normalization" silently broke the number it was normalizing.
    //   * NO VERIFICATION, despite the platform having a verify-my-number flow (now /customer/profile/phone/verify-current/*).
    //   * A signed-in customer could therefore point their booking codes, appointment reminders and AI-receptionist
    //     caller-ID at ANY number, instantly, with nothing proving they held it -- including a number belonging to
    //     somebody else, who would then start receiving that salon's messages.
    //
    // Phone changes go through the canonical flow (validate -> dedupe -> SMS verify -> activate under an optimistic
    // lock -> synchronise -> audit). `phone_display` stays editable: it is the human-readable rendering, and fixing
    // its formatting changes nothing about where a message goes.
    // Phase 3: formatting only — a rendering of a DIFFERENT number is ignored (audit E4); changes go through the
    // canonical phone flow.
    if (patch.phone !== undefined) { const e = normalizePhone(String(patch.phone ?? '')); if (e) set.phone_display = sql`CASE WHEN normalized_phone = ${e} THEN ${String(patch.phone)} ELSE phone_display END`; }
    if (patch.email !== undefined) set.email = patch.email;
    if (patch.smsOptIn !== undefined) set.marketing_sms_opt_in = patch.smsOptIn;
    if (patch.emailOptIn !== undefined) set.marketing_email_opt_in = patch.emailOptIn;
    if (patch.marketingOptIn !== undefined) set.marketing_opt_in = patch.marketingOptIn;
    if (patch.firstName !== undefined && patch.lastName !== undefined) { set.first_name = patch.firstName; set.last_name = patch.lastName; set.full_name = `${patch.firstName} ${patch.lastName}`.trim(); }
    // Birthday Campaigns (750): who recorded it and when — a customer's own edit is a full date (validBirthday: YYYY-MM-DD)
    if (patch.birthday !== undefined) { set.birthday = patch.birthday ? patch.birthday : null; set.birthday_year_known = true; set.birthday_source = patch.birthday ? 'customer_app' : null; set.birthday_updated_at = sql`now()`; }
    if (patch.avatarUrl !== undefined) set.avatar_url = patch.avatarUrl ? patch.avatarUrl : null;
    if (Object.keys(set).length === 1) return; // only updated_at present → nothing to change
    await this.db.updateTable('customers').set(set).where('tenant_id', '=', ctx.tenantId).where('id', '=', customerId).execute();
  }

  async customerQueue(ctx: CustomerContext, customerId: string): Promise<CustomerQueueRaw | null> {
    const active = [...QUEUE_ACTIVE] as string[];
    const mine = await this.db.selectFrom('pos_queue_items').select(['id', 'priority', 'status', 'checked_in_at', 'branch_id'])
      .where('tenant_id', '=', ctx.tenantId).where('customer_id', '=', customerId).where('status', 'in', active)
      .orderBy('checked_in_at', 'asc').executeTakeFirst();
    if (!mine) return null;
    const branchId = mine.branch_id as string | null;
    let q = this.db.selectFrom('pos_queue_items').select(['id', 'priority', 'checked_in_at'])
      .where('tenant_id', '=', ctx.tenantId).where('status', 'in', active);
    q = branchId ? q.where('branch_id', '=', branchId) : q.where('branch_id', 'is', null);
    const items = await q.execute();
    const techRow = await this.db.selectFrom('technicians').select((eb) => eb.fn.count<string>('id').as('c'))
      .where('tenant_id', '=', ctx.tenantId).where('status', '=', 'active').executeTakeFirst();
    const availableTechnicians = Number(techRow?.c ?? 0);
    const avgRow = await this.db.selectFrom('services').select((eb) => eb.fn.avg<string>('duration_minutes').as('a'))
      .where('tenant_id', '=', ctx.tenantId).where('status', '=', 'active').executeTakeFirst();
    const avgServiceMinutes = Math.round(Number(avgRow?.a ?? 0)) || 45;
    return {
      myItemId: mine.id, status: mine.status,
      items: (items as any[]).map((r) => ({ queueItemId: r.id, priority: r.priority, checkedInAtMs: new Date(r.checked_in_at).getTime() })),
      availableTechnicians, avgServiceMinutes,
    };
  }

  async salonInfo(ctx: CustomerContext): Promise<CustomerSalonInfo | null> {
    const cols = ['name', 'address', 'city', 'state', 'zip', 'phone'] as const;
    let row = ctx.branchId
      ? await this.db.selectFrom('branches').select([...cols, 'id']).where('tenant_id', '=', ctx.tenantId).where('id', '=', ctx.branchId).executeTakeFirst()
      : undefined;
    if (!row) row = await this.db.selectFrom('branches').select([...cols, 'id']).where('tenant_id', '=', ctx.tenantId).orderBy('created_at', 'asc').executeTakeFirst();
    if (!row) return null;
    const r = row;
    const cityState = [r.city, r.state].filter(Boolean).join(', ');
    const address = [r.address, [cityState, r.zip].filter(Boolean).join(' ').trim()].filter(Boolean).join(', ') || null;
    return { id: ctx.branchId || r.id, name: r.name, address, phone: r.phone ?? null };
  }

  async notifications(ctx: CustomerContext, customerId: string): Promise<CustomerNotification[]> {
    const rows = await this.db.selectFrom('customer_notifications')
      .select(['id', 'type', 'title', 'body', 'reference', 'read_at', 'created_at'])
      .where('tenant_id', '=', ctx.tenantId).where('customer_id', '=', customerId)
      .orderBy('created_at', 'desc').limit(50).execute();
    return rows.map((r) => ({ id: r.id, type: r.type, title: r.title, body: r.body ?? null, reference: r.reference ?? null, readAt: r.read_at ? iso(r.read_at) : null, createdAt: iso(r.created_at) }));
  }

  async markNotificationsRead(ctx: CustomerContext, customerId: string): Promise<void> {
    await this.db.updateTable('customer_notifications').set({ read_at: new Date() })
      .where('tenant_id', '=', ctx.tenantId).where('customer_id', '=', customerId).where('read_at', 'is', null).execute();
  }

  async giftCards(ctx: CustomerContext, customerId: string): Promise<CustomerGiftCard[]> {
    // The customer's own cards (tenant + customer scoped). Excludes not-yet-real cards (draft / pending_payment).
    // Only the masked reference is returned — never the raw redeemable code.
    const rows = await this.db.selectFrom('gift_cards')
      .select(['id', 'code', 'card_number_last4', 'reference', 'balance_cents', 'purchased_cents', 'promo_cents', 'status', 'created_at', 'expires_at'])
      .where('tenant_id', '=', ctx.tenantId).where('customer_id', '=', customerId)
      .where('status', 'not in', ['draft', 'pending_payment'])
      .orderBy('created_at', 'desc').limit(100).execute().catch(() => [] as any[]);
    return rows.map((r) => ({
      id: r.id,
      reference: r.reference || ('GC-****-' + String(r.code || '').slice(-4)),
      cardNumberMasked: r.card_number_last4 ? maskFromLast4(String(r.card_number_last4)) : null,
      balanceCents: Number(r.balance_cents || 0),
      purchasedCents: Number(r.purchased_cents || 0),
      promoCents: Number(r.promo_cents || 0),
      status: r.status,
      createdAt: iso(r.created_at),
      expiresAt: r.expires_at ? iso(r.expires_at) : null,
    }));
  }

  async giftCardForTransfer(ctx: CustomerContext, customerId: string, cardId: string): Promise<{ id: string; status: string; balanceCents: number } | null> {
    const r: any = await this.db.selectFrom('gift_cards').select(['id', 'status', 'balance_cents'])
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', cardId).where('customer_id', '=', customerId)
      .executeTakeFirst().catch(() => undefined);
    return r ? { id: String(r.id), status: String(r.status), balanceCents: Number(r.balance_cents || 0) } : null;
  }

  async createGiftCardClaim(ctx: CustomerContext, args: GiftCardClaimInput): Promise<{ senderName: string | null }> {
    const sender: any = await this.db.selectFrom('customers').select(['full_name']).where('tenant_id', '=', ctx.tenantId).where('id', '=', args.senderCustomerId).executeTakeFirst().catch(() => undefined);
    const senderName = args.senderName || sender?.full_name || null;
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('gift_card_claim_tokens').values({ tenant_id: ctx.tenantId, gift_card_id: args.cardId, token_hash: args.tokenHash, recipient_phone: args.recipientPhone || null, recipient_email: args.recipientEmail || null, expires_at: args.expiresAt }).execute();
      await trx.insertInto('gift_card_recipients').values({ tenant_id: ctx.tenantId, gift_card_id: args.cardId, recipient_name: args.recipientName || null, recipient_phone: args.recipientPhone || null, recipient_email: args.recipientEmail || null, message: args.message || null, sender_name: senderName }).execute();
    });
    return { senderName };
  }

  async recordGiftCardDelivery(ctx: CustomerContext, args: { cardId: string; channel: 'sms' | 'email' | 'in_app' | 'link'; destination?: string; status: string; providerMessageId?: string; failureReason?: string }): Promise<void> {
    await this.db.insertInto('gift_card_deliveries').values({
      tenant_id: ctx.tenantId, gift_card_id: args.cardId, channel: args.channel,
      destination: args.destination || null, status: args.status,
      provider_message_id: args.providerMessageId || null, failure_reason: args.failureReason || null,
    }).execute().catch(() => undefined);
  }

  async findGiftCardClaimByHash(ctx: CustomerContext, tokenHash: string): Promise<GiftCardClaimRow | null> {
    const r: any = await this.db.selectFrom('gift_card_claim_tokens').select(['id', 'gift_card_id', 'claimed_at', 'revoked_at', 'expires_at'])
      .where('tenant_id', '=', ctx.tenantId).where('token_hash', '=', tokenHash)
      .executeTakeFirst().catch(() => undefined);
    if (!r) return null;
    return { id: String(r.id), giftCardId: String(r.gift_card_id), claimedAt: r.claimed_at ? iso(r.claimed_at) : null, revokedAt: r.revoked_at ? iso(r.revoked_at) : null, expiresAt: iso(r.expires_at) };
  }

  async claimGiftCardTransfer(ctx: CustomerContext, claimId: string, giftCardId: string, claimerCustomerId: string): Promise<GiftCardClaimResult> {
    return this.db.transaction().execute(async (trx): Promise<GiftCardClaimResult> => {
      // Single-use: claim the token only if still unclaimed and unrevoked. If another claim won the race, 0 rows update.
      const upd: any = await trx.updateTable('gift_card_claim_tokens').set({ claimed_at: new Date(), claimed_by_customer_id: claimerCustomerId })
        .where('id', '=', claimId).where('tenant_id', '=', ctx.tenantId).where('claimed_at', 'is', null).where('revoked_at', 'is', null)
        .executeTakeFirst();
      if (Number(upd?.numUpdatedRows ?? 0) === 0) return { ok: false };
      // Transfer ownership to the claimer.
      await trx.updateTable('gift_cards').set({ customer_id: claimerCustomerId, recipient_id: claimerCustomerId })
        .where('id', '=', giftCardId).where('tenant_id', '=', ctx.tenantId).execute();
      // §11: revoke any outstanding presentation tokens (barcodes) so the previous owner's codes stop working immediately.
      await trx.updateTable('gift_card_presentation_tokens').set({ revoked_at: new Date() })
        .where('gift_card_id', '=', giftCardId).where('tenant_id', '=', ctx.tenantId)
        .where('revoked_at', 'is', null).where('used_at', 'is', null).execute();
      await trx.updateTable('gift_card_recipients').set({ customer_id: claimerCustomerId })
        .where('gift_card_id', '=', giftCardId).where('tenant_id', '=', ctx.tenantId).where('customer_id', 'is', null).execute();
      const card: any = await trx.selectFrom('gift_cards').select(['code', 'balance_cents', 'reference']).where('tenant_id', '=', ctx.tenantId).where('id', '=', giftCardId).executeTakeFirst();
      const rec: any = await trx.selectFrom('gift_card_recipients').select(['sender_name', 'message']).where('gift_card_id', '=', giftCardId).where('tenant_id', '=', ctx.tenantId).orderBy('created_at', 'desc').executeTakeFirst().catch(() => undefined);
      const reference = card?.reference || ('GC-****-' + String(card?.code || '').slice(-4));
      return { ok: true, reference, balanceCents: Number(card?.balance_cents || 0), senderName: rec?.sender_name || undefined, message: rec?.message || undefined };
    }).catch((): GiftCardClaimResult => ({ ok: false }));
  }

  async reportGiftCardLost(ctx: CustomerContext, customerId: string, cardId: string): Promise<{ ok: boolean; reason?: string }> {
    return this.db.transaction().execute(async (trx): Promise<{ ok: boolean; reason?: string }> => {
      const card: any = await trx.selectFrom('gift_cards').select(['id', 'status', 'balance_cents'])
        .where('tenant_id', '=', ctx.tenantId).where('id', '=', cardId).where('customer_id', '=', customerId)
        .executeTakeFirst();
      if (!card) return { ok: false, reason: 'not_found' };
      if (card.status !== 'active' && card.status !== 'partially_redeemed') return { ok: false, reason: 'not_freezable' };
      // Single-flip freeze: only if still in a freezable state (guards against a concurrent double-report).
      const upd = await trx.updateTable('gift_cards').set({ status: 'frozen', updated_at: new Date() })
        .where('id', '=', cardId).where('tenant_id', '=', ctx.tenantId).where('status', 'in', ['active', 'partially_redeemed']).where(canMoveToSql(GIFT_CARD, 'frozen') as any)
        .executeTakeFirst();
      if (Number(upd?.numUpdatedRows ?? 0) === 0) return { ok: false, reason: 'not_freezable' };
      // Freeze ledger event: 0 amount, balance preserved (the value is protected, not spent).
      await trx.insertInto('gift_card_transactions').values({
        tenant_id: ctx.tenantId, gift_card_id: cardId, type: 'freeze', amount_cents: 0,
        balance_after_cents: Number(card.balance_cents || 0), created_by_user_id: null,
      }).execute();
      // §11: a lost card's outstanding barcodes must stop working immediately.
      await trx.updateTable('gift_card_presentation_tokens').set({ revoked_at: new Date() })
        .where('gift_card_id', '=', cardId).where('tenant_id', '=', ctx.tenantId)
        .where('revoked_at', 'is', null).where('used_at', 'is', null).execute();
      return { ok: true };
    }).catch((): { ok: boolean; reason?: string } => ({ ok: false, reason: 'error' }));
  }

  async cancelAppointment(ctx: CustomerContext, customerId: string, appointmentId: string): Promise<boolean> {
    let before: any;
    try { before = await this.db.selectFrom('pos_tech_appointments').select('status').where('tenant_id', '=', ctx.tenantId).where('customer_id', '=', customerId).where('id', '=', appointmentId).executeTakeFirst(); } catch { before = undefined; }
    // BUILD_PLAN Phase 5, bug 12: the status change, its change-log row and appointment.canceled commit together. The
    // customer app's cancel emitted no event, so nothing downstream heard it — a deal booked with the appointment kept
    // its place until the lifecycle safety net found it (the deals-release consumer gives it back now, at once).
    return this.db.transaction().execute(async (trx) => {
      const res = await trx.updateTable('pos_tech_appointments').set({ status: 'cancelled' })
        .where('tenant_id', '=', ctx.tenantId).where('customer_id', '=', customerId).where('id', '=', appointmentId)
        .where('status', 'in', ['booked', 'confirmed']).where(canMoveToSql(APPOINTMENT, 'cancelled') as any).executeTakeFirst();
      const ok = Number(res?.numUpdatedRows ?? 0) > 0;
      if (!ok) return false;
      await recordAppointmentChanges(trx as unknown as Kysely<DB>, { tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, actorType: 'customer', actorId: customerId, source: 'customer' }, appointmentId, 'cancelled', [{ field: 'status', old: before?.status, new: 'cancelled' }]);
      if (this.outbox) await this.outbox.write(trx, createDomainEvent({
        eventType: DOMAIN_EVENTS.APPOINTMENT_CANCELED, tenantId: ctx.tenantId, branchId: ctx.branchId || undefined,
        aggregateType: 'appointment', aggregateId: appointmentId, actorId: ctx.userId ?? undefined, actorType: 'user',
        payload: { appointmentId, previousStatus: before?.status ?? null, status: 'cancelled', source: 'customer_app' },
      }));
      return true;
    });
  }

  private mapAddress(r: any): CustomerAddress {
    return { id: r.id, label: r.label ?? null, line1: r.line1, line2: r.line2 ?? null, city: r.city ?? null, state: r.state ?? null, zip: r.zip ?? null, isDefault: !!r.is_default };
  }
  async listAddresses(ctx: CustomerContext, customerId: string): Promise<CustomerAddress[]> {
    const rows = await this.db.selectFrom('customer_addresses').select(['id', 'label', 'line1', 'line2', 'city', 'state', 'zip', 'is_default'])
      .where('tenant_id', '=', ctx.tenantId).where('customer_id', '=', customerId)
      .orderBy('is_default', 'desc').orderBy('created_at', 'asc').execute();
    return rows.map((r) => this.mapAddress(r));
  }
  async createAddress(ctx: CustomerContext, customerId: string, body: CreateAddressRequest): Promise<CustomerAddress> {
    return this.db.transaction().execute(async (trx) => {
      if (body.isDefault) {
        await trx.updateTable('customer_addresses').set({ is_default: false })
          .where('tenant_id', '=', ctx.tenantId).where('customer_id', '=', customerId).execute();
      }
      const row = await trx.insertInto('customer_addresses').values({
        tenant_id: ctx.tenantId, customer_id: customerId, label: body.label ?? null, line1: body.line1,
        line2: body.line2 ?? null, city: body.city ?? null, state: body.state ?? null, zip: body.zip ?? null, is_default: !!body.isDefault,
      }).returning(['id', 'label', 'line1', 'line2', 'city', 'state', 'zip', 'is_default']).executeTakeFirstOrThrow();
      return this.mapAddress(row);
    });
  }
  async deleteAddress(ctx: CustomerContext, customerId: string, id: string): Promise<boolean> {
    const res = await this.db.deleteFrom('customer_addresses')
      .where('tenant_id', '=', ctx.tenantId).where('customer_id', '=', customerId).where('id', '=', id).executeTakeFirst();
    return Number(res?.numDeletedRows ?? 0) > 0;
  }
  async setDefaultAddress(ctx: CustomerContext, customerId: string, id: string): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const exists = await trx.selectFrom('customer_addresses').select('id')
        .where('tenant_id', '=', ctx.tenantId).where('customer_id', '=', customerId).where('id', '=', id).executeTakeFirst();
      if (!exists) return false;
      await trx.updateTable('customer_addresses').set({ is_default: false }).where('tenant_id', '=', ctx.tenantId).where('customer_id', '=', customerId).execute();
      await trx.updateTable('customer_addresses').set({ is_default: true }).where('tenant_id', '=', ctx.tenantId).where('customer_id', '=', customerId).where('id', '=', id).execute();
      return true;
    });
  }
  // BUILD_PLAN Phase 5: the customer app's Deals list (and the in-app AI receptionist that reads it) came from
  // customer_deals — a table nothing ever wrote, so every salon showed an empty list. It now reads the one deals domain:
  // this salon's live deals, coupons and announcements in their window, not suspended, offered in the customer app, and
  // only while the salon's deals are switched on. Coupon codes are never shown (they are stored hashed).
  async listDeals(ctx: CustomerContext): Promise<CustomerDeal[]> {
    const rows = (await sql<any>`
      SELECT d.id, d.kind, d.title, d.short_description, d.terms, d.starts_at, d.ends_at, d.discount_type, d.discount_percent, d.discount_cents,
             d.original_price_cents, d.final_price_cents, d.requires_code
        FROM deals d LEFT JOIN deal_settings s ON s.tenant_id = d.tenant_id
       WHERE d.tenant_id = ${ctx.tenantId} AND d.status = 'active' AND d.kind IN ('deal','coupon','announcement') AND d.suspended_at IS NULL
         AND (d.starts_at IS NULL OR d.starts_at <= now()) AND (d.ends_at IS NULL OR d.ends_at > now())
         AND (d.channels IS NULL OR 'customer_app' = ANY(d.channels))
         AND COALESCE(s.platform_disabled, false) = false AND COALESCE(s.deals_enabled, true) = true
         AND NOT EXISTS (SELECT 1 FROM platform_settings p WHERE p.setting_key = 'deals.engine_disabled' AND p.value::text IN ('true','"true"'))
         AND (d.max_redemptions IS NULL OR (SELECT count(*) FROM deal_redemption_holds h WHERE h.tenant_id = ${ctx.tenantId} AND h.deal_id = d.id
               AND (h.status IN ('consumed','redeemed') OR (h.status = 'held' AND h.expires_at > now()))) < d.max_redemptions)   -- no place left: not offered
         AND (d.budget_cents IS NULL OR d.budget_reserved_cents < d.budget_cents)
       ORDER BY d.priority, d.created_at DESC LIMIT 100`.execute(this.db)).rows;
    return rows.map((r) => ({ id: String(r.id), kind: r.kind, title: r.title, description: r.short_description ?? null, code: null, terms: r.terms ?? null,
      startsAt: r.starts_at ? iso(r.starts_at) : null, endsAt: r.ends_at ? iso(r.ends_at) : null, discountType: r.kind === 'announcement' ? null : r.discount_type,
      discountPercent: r.discount_percent == null ? null : Number(r.discount_percent), discountCents: r.kind === 'announcement' || r.discount_cents == null ? null : Number(r.discount_cents),
      originalPriceCents: r.original_price_cents == null ? null : Number(r.original_price_cents), finalPriceCents: r.final_price_cents == null ? null : Number(r.final_price_cents),
      requiresCode: !!r.requires_code, bookable: r.kind === 'deal' }));
  }
  async getOrCreateReferralCode(ctx: CustomerContext, customerId: string): Promise<string> {
    const existing = await this.db.selectFrom('customer_referrals').select('code')
      .where('tenant_id', '=', ctx.tenantId).where('customer_id', '=', customerId).executeTakeFirst();
    if (existing) return existing.code;
    const code = 'REF' + String(customerId).replace(/-/g, '').slice(0, 10).toUpperCase();
    await this.db.insertInto('customer_referrals').values({ tenant_id: ctx.tenantId, customer_id: customerId, code })
      .onConflict((oc) => oc.columns(['tenant_id', 'customer_id']).doNothing()).execute();
    const row = await this.db.selectFrom('customer_referrals').select('code')
      .where('tenant_id', '=', ctx.tenantId).where('customer_id', '=', customerId).executeTakeFirst();
    return row?.code ?? code;
  }

  // ── Default salon (Oct 3 2026) ──
  async homeSalon(ctx: CustomerContext, customerId: string): Promise<HomeSalon | null> {
    const r: any = await this.db.selectFrom('customers as c').innerJoin('branches as b', 'b.id', 'c.branch_id')
      .select(['b.id as id', (eb: any) => eb.fn.coalesce('b.public_display_name', 'b.name').as('name'), 'b.city as city'])
      .where('c.tenant_id', '=', ctx.tenantId).where('c.id', '=', customerId).executeTakeFirst().catch(() => null);
    return r ? { salonId: String(r.id), salonName: String(r.name), city: r.city ?? null } : null;
  }
  async setHomeSalon(ctx: CustomerContext, customerId: string, salonId: string): Promise<SetHomeSalonResult> {
    // Only a live, public location of an ACTIVE salon business can be chosen (the same rule as sign-up).
    const b: any = await this.db.selectFrom('branches as b').innerJoin('tenants as t', 't.id', 'b.tenant_id')
      .select(['b.id as id', 'b.tenant_id as tenant_id', (eb: any) => eb.fn.coalesce('b.public_display_name', 'b.name').as('name')])
      .where('b.id', '=', salonId).where('b.status', '=', 'active').where('b.deleted_at', 'is', null).where('b.is_public', '=', true).where('t.status', '=', 'active')
      .executeTakeFirst();
    if (!b) return { ok: false, message: 'That salon isn’t available.' };
    const salonName = String(b.name);
    const me: any = await this.db.selectFrom('users').select(['id', 'email', 'normalized_phone', 'password_hash', 'full_name', 'first_name', 'last_name'])
      .where('id', '=', ctx.userId).where('tenant_id', '=', ctx.tenantId).where('role', '=', 'CUSTOMER').executeTakeFirst();
    if (!me) return { ok: false, message: 'Your account could not be found.' };
    const cust: any = await this.db.selectFrom('customers').select(['first_name', 'last_name', 'full_name', 'phone_display', 'email'])
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', customerId).executeTakeFirst();
    const now = new Date();

    // Same salon business: just move the home location. Effective immediately.
    if (String(b.tenant_id) === ctx.tenantId) {
      await this.db.transaction().execute(async (trx) => {
        await trx.updateTable('customers').set({ branch_id: salonId, updated_at: now }).where('tenant_id', '=', ctx.tenantId).where('id', '=', customerId).execute();
        await trx.updateTable('users').set({ branch_id: salonId, customer_default_at: now }).where('tenant_id', '=', ctx.tenantId).where('id', '=', ctx.userId).execute();
      });
      return { ok: true, salonName };
    }

    // Another salon business: this person's CUSTOMER account there (by email, else phone) becomes the default; if they have
    // none it is created with the same name, contact details and password (the hash is copied server-side, never exposed).
    // The session belongs to the current salon, so they sign in again to land at the new one.
    const target = String(b.tenant_id);
    const email = me.email ? String(me.email).toLowerCase() : null, phone = me.normalized_phone ?? null;
    if (!email && !phone) return { ok: false, message: 'Add an email or phone number to your account first.' };
    const existing: any = await this.db.selectFrom('users').select(['id']).where('tenant_id', '=', target).where('role', '=', 'CUSTOMER')
      .where((eb: any) => eb.or([...(email ? [eb(eb.fn('lower', ['email']), '=', email)] : []), ...(phone ? [eb('normalized_phone', '=', phone)] : [])])).executeTakeFirst();
    await this.db.transaction().execute(async (trx) => {
      let userId: string;
      if (existing) {
        userId = String(existing.id);
        await trx.updateTable('users').set({ customer_default_at: now }).where('tenant_id', '=', target).where('id', '=', userId).execute();
      } else {
        const u: any = await trx.insertInto('users').values({ tenant_id: target, branch_id: salonId, email: me.email, normalized_phone: phone, password_hash: me.password_hash,
          full_name: me.full_name, first_name: me.first_name, last_name: me.last_name, status: 'active', role: 'CUSTOMER', customer_default_at: now } as any).returning('id').executeTakeFirstOrThrow();
        userId = String(u.id);
        const first = cust?.first_name ?? me.first_name ?? '', last = cust?.last_name ?? me.last_name ?? '';
        const c: any = await trx.insertInto('customers').values({ tenant_id: target, branch_id: salonId, first_name: first, last_name: last, full_name: cust?.full_name ?? me.full_name ?? `${first} ${last}`.trim(),
          email: me.email, phone_display: cust?.phone_display ?? null, normalized_phone: phone, user_id: userId, status: 'active' } as any).returning('id').executeTakeFirstOrThrow();
        // One person, one password, many salons: if this account has a sign-in identity, the new salon hangs off it too.
        await sql`insert into customer_identity_links (identity_id, tenant_id, user_id, customer_id)
          select l.identity_id, ${target}::uuid, ${userId}::uuid, ${String(c.id)}::uuid from customer_identity_links l where l.user_id = ${ctx.userId}::uuid
          on conflict do nothing`.execute(trx);
      }
    });
    return { ok: true, salonName, requiresSignIn: true };
  }

  async checkInAppointment(ctx: CustomerContext, customerId: string, appointmentId: string): Promise<CustomerCheckInResult> {
    const appt = await this.db.selectFrom('pos_tech_appointments')
      .select(['id', 'branch_id', 'customer_name', 'customer_phone', 'is_vip', 'services', 'status', 'technician_id'])
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', appointmentId).where('customer_id', '=', customerId).executeTakeFirst();
    if (!appt) return { ok: false, message: 'Appointment not found.' };
    // idempotent: if an active queue item already exists for this appointment, the customer is already checked in
    const existing = await this.db.selectFrom('pos_queue_items').select(['id'])
      .where('tenant_id', '=', ctx.tenantId).where('appointment_id', '=', appointmentId).where('status', 'in', [...QUEUE_ACTIVE]).executeTakeFirst();
    if (existing) return { ok: true, queueItemId: existing.id, alreadyCheckedIn: true };
    if (!isCheckInEligible(appt.status)) return { ok: false, message: 'This appointment can\u2019t be checked in.' };   // booked, confirmed or arrived (Decision 38)
    // "Today" is the appointment's BRANCH's day (Oct 3 2026): with the database's UTC date, a customer checking in at
    // 8:30 pm New Jersey time for tonight's appointment was told to come back on the day of the appointment.
    const ap: any = await this.db.selectFrom('pos_tech_appointments').select(['appt_date', 'branch_id'])
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', appointmentId).executeTakeFirst();
    const apDay = ap?.appt_date ? (ap.appt_date instanceof Date ? ap.appt_date.toISOString() : String(ap.appt_date)).slice(0, 10) : '';
    if (!ap || apDay !== businessDate(await branchTimeZone(this.db, ctx.tenantId, ap.branch_id ?? null))) return { ok: false, message: 'You can check in on the day of your appointment.' };
    // create the SAME pos_queue_items row a POS check-in would, and mark the appointment checked in (one transaction)
    const result = await this.db.transaction().execute(async (trx) => {
      // Serialize concurrent check-ins for THIS appointment — a double-tap of "I'm here", a client retry, or a POS
      // check-in landing at the same instant — then RE-CHECK under the lock. The pre-check above is only a fast path;
      // this is what guarantees exactly one active queue item (the outer SELECT→INSERT would otherwise race).
      await sql`select pg_advisory_xact_lock(hashtextextended(${'checkin:' + appointmentId}, 0))`.execute(trx);
      const dup = await trx.selectFrom('pos_queue_items').select(['id'])
        .where('tenant_id', '=', ctx.tenantId).where('appointment_id', '=', appointmentId).where('status', 'in', [...QUEUE_ACTIVE]).executeTakeFirst();
      if (dup) return { ok: true as const, queueItemId: dup.id, alreadyCheckedIn: true };
      const rawSvcs = Array.isArray(appt.services) ? appt.services : (typeof appt.services === 'string' ? (() => { try { return JSON.parse(appt.services); } catch { return []; } })() : []);
      const queueServices = rawSvcs.map((s: any) => ({
        serviceId: s.serviceId,
        serviceName: s.serviceName || s.name || 'Service',
        estimatedDurationMinutes: Number(s.durationMinutes ?? s.estimatedDurationMinutes ?? 30),
        priceCents: Number(s.priceCents ?? 0),
      }));
      const ins = await trx.insertInto('pos_queue_items').values({
        tenant_id: ctx.tenantId, branch_id: (appt as any).branch_id, customer_id: customerId, customer_name: (appt as any).customer_name ?? null,
        customer_phone: appt.customer_phone ?? null, is_vip: !!appt.is_vip, source: 'appointment', appointment_id: appointmentId,
        ticket_id: null, requested_services: JSON.stringify(queueServices), priority: 'normal', status: 'waiting', checked_in_at: new Date(),
        // developer merge (Oct 6 2026): the guest asks for the technician they booked with — the board showed "any
        // technician" and routing did not prefer the booked one (the POS check-in of an appointment already did this)
        requested_technician_id: appt.technician_id ?? null,
      }).returning(['id']).executeTakeFirstOrThrow();
      await trx.updateTable('pos_tech_appointments').set({ status: 'checked_in' } as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', appointmentId).where(canMoveToSql(APPOINTMENT, 'checked_in') as any).execute();
      // the fact commits with the rows (§18): the in-app feed, the customer's and technician's push, the live boards
      // all consume checkin.customer_checked_in — this path recorded nothing before (the POS / tech-app paths did)
      if (this.outbox) await this.outbox.write(trx, createDomainEvent({
        eventType: DOMAIN_EVENTS.CUSTOMER_CHECKED_IN, tenantId: ctx.tenantId, branchId: appt.branch_id || undefined,
        aggregateType: 'appointment', aggregateId: appointmentId, actorId: ctx.userId ?? undefined, actorType: 'user',
        payload: { appointmentId, queueItemId: String(ins.id), previousStatus: appt.status ?? null, status: 'checked_in', source: 'customer_app' },
      }));
      return { ok: true, queueItemId: ins.id };
    }).catch(async (e: any) => {
      if (e?.code === '23505' || /duplicate key|uq_pos_queue_active/i.test(String(e?.constraint ?? e?.message ?? ''))) {
        const active = await this.db.selectFrom('pos_queue_items').select(['id'])
          .where('tenant_id', '=', ctx.tenantId).where('appointment_id', '=', appointmentId).where('status', 'in', [...QUEUE_ACTIVE]).executeTakeFirst();
        if (active) return { ok: true as const, queueItemId: String(active.id), alreadyCheckedIn: true };
      }
      throw e;
    });
    // Record the lifecycle change AFTER commit (never inside the txn — a swallowed audit error must not abort the check-in).
    if (result.ok && !result.alreadyCheckedIn) await recordAppointmentChanges(this.db, { tenantId: ctx.tenantId, branchId: appt.branch_id ?? null, actorType: 'customer', actorId: customerId, source: 'customer_app' }, appointmentId, 'status_changed', [{ field: 'status', old: appt.status, new: 'checked_in' }]);
    return result;
  }


  async listRewards(ctx: CustomerContext, customerId: string): Promise<RewardsView> {
    const points = await this.loyaltyPoints(ctx, customerId);
    // Decision 15: only rewards WORTH something are offered — a zero-value reward used to take points for a code that
    // took nothing off at checkout.
    const rows = await this.db.selectFrom('loyalty_rewards').select(['id', 'title', 'description', 'points_cost', 'reward_type', 'value_cents', 'percent', 'valid_days'])
      .where('tenant_id', '=', ctx.tenantId).where('active', '=', true)
      .where((eb: any) => eb.or([eb.and([eb('reward_type', '=', 'amount_off'), eb('value_cents', '>', 0)]), eb.and([eb('reward_type', '=', 'percent_off'), eb('percent', '>', 0)])]))
      .orderBy('sort_order', 'asc').orderBy('points_cost', 'asc').execute();
    const label = (r: any) => (r.reward_type === 'percent_off' ? `${Number(r.percent)}% off` : `$${(Number(r.value_cents) / 100).toFixed(2)} off`);
    return { points, rewards: rows.map((r) => ({ id: r.id, title: r.title, description: r.description ?? '', pointsCost: Number(r.points_cost), affordable: points >= Number(r.points_cost),
      valueLabel: label(r), validDays: r.valid_days == null ? null : Number(r.valid_days) })) };
  }

  async redeemReward(ctx: CustomerContext, customerId: string, rewardId: string): Promise<RedeemResult> {
    const reward = await this.db.selectFrom('loyalty_rewards').select(['id', 'title', 'points_cost', 'active', 'reward_type', 'value_cents', 'percent', 'valid_days'])
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', rewardId).executeTakeFirst();
    const worth = reward && ((reward.reward_type === 'percent_off' && Number(reward.percent) > 0) || (reward.reward_type !== 'percent_off' && Number(reward.value_cents) > 0));
    if (!reward || !reward.active || !worth) return { ok: false, message: 'That reward is not available.' };
    const cost = Number(reward.points_cost);
    return this.db.transaction().execute(async (trx) => {
      // Phase 10: points leave only through the loyalty ledger. Lock the customer, check the balance, then one `redeem`
      // entry keyed by the redemption row (so a retried insert can never debit twice).
      await lockLoyaltyCustomer(trx as any, ctx.tenantId, customerId);
      const cur = await trx.selectFrom('customer_loyalty_profiles').select('points_balance').where('tenant_id', '=', ctx.tenantId).where('customer_id', '=', customerId).orderBy('created_at').executeTakeFirst();
      if (Number(cur?.points_balance ?? 0) < cost) return { ok: false, message: 'Not enough points to redeem this reward.', pointsBalance: cur?.points_balance ?? 0 };
      const code = 'RDM' + secureString(8);   // H9: a bearer reward code — was Math.random()
      // Decision 15: the code carries a SNAPSHOT of the reward's value and its expiry — editing the reward later never
      // changes a code already issued.
      const rw: any = reward;
      const expiresAt = rw.valid_days ? new Date(Date.now() + Number(rw.valid_days) * 86_400_000) : null;
      const red: any = await trx.insertInto('loyalty_redemptions').values({ tenant_id: ctx.tenantId, customer_id: customerId, reward_id: rewardId, reward_title: rw.title, points_spent: cost, code,
        status: 'issued', reward_type: rw.reward_type === 'percent_off' ? 'percent_off' : 'amount_off', value_cents: rw.reward_type === 'percent_off' ? 0 : Number(rw.value_cents), percent: rw.reward_type === 'percent_off' ? Number(rw.percent) : 0, expires_at: expiresAt }).returning('id').executeTakeFirst();
      // loyalty.points_redeemed — declared since Constitution 8, recorded by nothing until now. Points + ids; never the
      // bearer reward code.
      if (this.outbox) await this.outbox.write(trx, createDomainEvent({ eventType: DOMAIN_EVENTS.LOYALTY_POINTS_REDEEMED, tenantId: ctx.tenantId, branchId: ctx.branchId || undefined,
        aggregateType: 'loyalty_redemption', aggregateId: String(red?.id ?? rewardId), actorId: ctx.userId || undefined, actorType: 'user',
        payload: { customerId, rewardId, pointsSpent: cost } }));
      await trx.insertInto('customer_notifications').values({ tenant_id: ctx.tenantId, customer_id: customerId, type: 'loyalty', title: 'Reward redeemed', body: `${reward.title} \u2014 code ${code}`, reference: rewardId }).execute();
      const newBalance = cost > 0 ? (await applyLoyaltyEntry(trx as any, { tenantId: ctx.tenantId, branchId: ctx.branchId || null, customerId, entryType: 'redeem', delta: -cost,
        reason: `Redeemed reward: ${reward.title}`, sourceTable: 'loyalty_redemptions', sourceId: String(red.id), actorUserId: null,
        legacyType: 'redeem_reward', legacySource: 'customer_app' })).balanceAfter : Number(cur?.points_balance ?? 0);
      return { ok: true, code, pointsBalance: newBalance };
    });
  }

  async customerBranchId(ctx: CustomerContext, customerId: string): Promise<string | null> {
    const r = await this.db.selectFrom('customers').select(['branch_id']).where('tenant_id', '=', ctx.tenantId).where('id', '=', customerId).executeTakeFirst();
    return r?.branch_id ?? null;
  }

  async profile(ctx: CustomerContext, customerId: string): Promise<CustomerProfile> {
    const row = await this.db.selectFrom('customers').select(['full_name', 'first_name', 'last_name', 'email', 'phone_display', 'birthday', 'birthday_year_known', 'phone_verified_at', 'marketing_opt_in', 'marketing_sms_opt_in', 'marketing_email_opt_in', 'avatar_url'])
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', customerId).executeTakeFirst();
    const r = row as any;
    // a DATE is a calendar date: read its parts (toISOString shifted it a day back on a server east of UTC). A month/day-only
    // birthday recorded by the salon is shown without its placeholder year.
    const bday = r?.birthday ? (r.birthday_year_known === false ? `--${storedDateString(r.birthday)!.slice(5)}` : storedDateString(r.birthday)) : null;
    return { fullName: r?.full_name ?? null, firstName: r?.first_name ?? null, lastName: r?.last_name ?? null, email: r?.email ?? null, phone: r?.phone_display ?? null, birthday: bday, smsOptIn: !!r?.marketing_sms_opt_in, emailOptIn: !!r?.marketing_email_opt_in, marketingOptIn: !!r?.marketing_opt_in, phoneVerified: !!r?.phone_verified_at, avatarUrl: r?.avatar_url ? buildMediaUrl(r.avatar_url) : null };
  }
}
