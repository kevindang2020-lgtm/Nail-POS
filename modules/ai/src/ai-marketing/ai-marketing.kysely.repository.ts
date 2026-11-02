// ai-marketing.kysely.repository.ts — Kysely adapter. Reads ONLY existing tables (campaigns, customers,
// pos_tech_appointments, notification_opt_outs), always tenant-scoped from server-derived ctx. Nothing is
// created or written here (slice 1 is read-only). Each aggregate is independently guarded: on any query
// failure it returns an honest ZERO rather than a fabricated number (honest-verification invariant).
//
// Schema facts this adapter depends on (verified against migrations/kysely.types, not assumed):
//   - The canonical appointment table is `pos_tech_appointments` (NOT `appointments`).
//   - Its date column is `appt_date DATE`; `start_time` is a time-of-day TEXT. Date math uses appt_date,
//     matching existing repositories (e.g. `a.appt_date < ${d}::date`, `appt_date >= current_date`).
//   - Completed visit => status = 'completed'. Live/future => status IN (booked,confirmed,checked_in,
//     waiting,in_service).
//   - Suppression: notification_opt_outs(tenant_id, channel, address); sms address = customers.normalized_phone.
//
// LIVE VERIFICATION NOTE: these correlated aggregates must be smoke-tested against seeded live Postgres
// (two-tenant) before their counts are trusted in production — like the gift-cards/loyalty/salon-promotions
// slices. The service composition logic is fully unit-tested via the in-memory adapter regardless.
import { branchTimeZone } from '@aipowersalon/database';
import { businessDate } from '@aipowersalon/date-time';
import { sql, type Kysely } from 'kysely';
import { CHAIR_HOLDING_STATUSES } from '@aipowersalon/api-contracts';
import type { DB } from '@aipowersalon/database';
import type { AiMarketingContext, MarketingReadModel, EligibleAudience } from './ai-marketing.dto';
import type { AiMarketingRepositoryPort } from './ai-marketing.repository';
import { EMPTY_READ_MODEL } from './ai-marketing.repository';
import type { AudienceDefinition, AudiencePreview } from './ai-marketing-audience';

const REBOOK_WINDOW_DAYS = 42; // default rebooking cadence; tenant-configurable override is a later slice
const INACTIVE_DAYS = 90;
const UPCOMING_STATUSES = CHAIR_HOLDING_STATUSES;   // Decision 38: the shared list (incl. arrived)

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function dateNDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10); // YYYY-MM-DD
}

export class KyselyAiMarketingRepository implements AiMarketingRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}

  private tenantWhere(qb: any, ctx: AiMarketingContext): any {
    let q = qb.where('tenant_id', '=', ctx.tenantId);
    if (ctx.branchId) q = q.where('branch_id', '=', ctx.branchId);
    return q;
  }

  async getReadModel(ctx: AiMarketingContext): Promise<MarketingReadModel> {
    const [campaignCounts, campaignTotals, consent, rebookingDue, inactive90, birthdayThisMonth] =
      await Promise.all([
        this.campaignCounts(ctx),
        this.campaignTotals(ctx),
        this.consent(ctx),
        this.dueAudience(ctx, REBOOK_WINDOW_DAYS),
        this.dueAudience(ctx, INACTIVE_DAYS),
        this.birthdayThisMonth(ctx),
      ]);
    return {
      campaignCounts,
      campaignTotals,
      consent,
      audiences: {
        rebookingDue,
        inactive90,
        birthdayThisMonth,
        lastMinuteInterest: { eligible: 0, suppressed: 0 }, // live availability = later slice; honest zero
      },
    };
  }

  private async campaignCounts(ctx: AiMarketingContext): Promise<MarketingReadModel['campaignCounts']> {
    try {
      const rows = await this.tenantWhere(this.db.selectFrom('campaigns'), ctx)
        .select((eb: any) => ['status', eb.fn.countAll().as('n')])
        .groupBy('status')
        .execute();
      const bucket = { active: 0, scheduled: 0, draft: 0, completed: 0 };
      for (const r of rows) {
        const s = String(r.status);
        const n = num(r.n);
        if (s === 'in_progress') bucket.active += n;
        else if (s === 'scheduled') bucket.scheduled += n;
        else if (s === 'draft') bucket.draft += n;
        else if (s === 'completed') bucket.completed += n;
      }
      return bucket;
    } catch {
      return { ...EMPTY_READ_MODEL.campaignCounts };
    }
  }

  private async campaignTotals(ctx: AiMarketingContext): Promise<MarketingReadModel['campaignTotals']> {
    try {
      const r = await this.tenantWhere(this.db.selectFrom('campaigns'), ctx)
        .select((eb: any) => [
          eb.fn.sum('sent_count').as('sent'),
          eb.fn.sum('booking_count').as('bookings'),
          eb.fn.sum('revenue_cents').as('revenue'),
          eb.fn.sum('cost_cents').as('cost'),
        ])
        .executeTakeFirst();
      return { sent: num(r?.sent), bookings: num(r?.bookings), revenueCents: num(r?.revenue), costCents: num(r?.cost) };
    } catch {
      return { ...EMPTY_READ_MODEL.campaignTotals };
    }
  }

  private async consent(ctx: AiMarketingContext): Promise<MarketingReadModel['consent']> {
    let optedInSms = 0, optedInEmail = 0, suppressed = 0;
    try {
      const r = await this.tenantWhere(this.db.selectFrom('customers'), ctx)
        .where('archived_at', 'is', null)
        .select((eb: any) => [
          eb.fn.count('id').filterWhere('marketing_sms_opt_in', '=', true).as('sms'),
          eb.fn.count('id').filterWhere('marketing_email_opt_in', '=', true).as('email'),
        ])
        .executeTakeFirst();
      optedInSms = num(r?.sms);
      optedInEmail = num(r?.email);
    } catch { /* honest zero */ }
    try {
      const r: any = await sql`SELECT count(*)::int AS n FROM notification_opt_outs WHERE tenant_id = ${ctx.tenantId}`.execute(this.db);
      suppressed = num(r?.rows?.[0]?.n);
    } catch { /* honest zero */ }
    return { optedInSms, optedInEmail, suppressed };
  }

  // Customers holding SMS consent, with a completed visit older than `days`, and NO live future appointment.
  // eligible additionally requires a usable, non-suppressed phone; suppressed = base population minus eligible.
  private async dueAudience(ctx: AiMarketingContext, days: number): Promise<EligibleAudience> {
    const upcomingFrom = businessDate(await branchTimeZone(this.db, ctx.tenantId, ctx.branchId ?? null));   // the salon's day
    try {
      const cutoff = dateNDaysAgo(days);
      const base = () => {
        let q = this.db.selectFrom('customers as c')
          .where('c.tenant_id', '=', ctx.tenantId)
          .where('c.archived_at', 'is', null)
          .where('c.marketing_sms_opt_in', '=', true)
          .where((eb: any) => eb.exists(
            eb.selectFrom('pos_tech_appointments as a').select('a.id')
              .whereRef('a.customer_id', '=', 'c.id')
              .where('a.tenant_id', '=', ctx.tenantId)
              .where('a.status', '=', 'completed')
              .where(sql<boolean>`a.appt_date < ${cutoff}::date`),
          ))
          .where((eb: any) => eb.not(eb.exists(
            eb.selectFrom('pos_tech_appointments as a2').select('a2.id')
              .whereRef('a2.customer_id', '=', 'c.id')
              .where('a2.tenant_id', '=', ctx.tenantId)
              .where('a2.status', 'in', UPCOMING_STATUSES as unknown as string[])
              .where('a2.appt_date', '>=', upcomingFrom)   /* the salon's day (Oct 3 2026 — was the database's UTC date) */,
          )));
        if (ctx.branchId) q = q.where('c.branch_id', '=', ctx.branchId);
        return q;
      };
      const total = num((await base().select((eb: any) => eb.fn.count('c.id').as('n')).executeTakeFirst() as any)?.n);
      const eligible = num((await this.withUsableSms(base(), ctx).select((eb: any) => eb.fn.count('c.id').as('n')).executeTakeFirst())?.n);
      return { eligible, suppressed: Math.max(0, total - eligible) };
    } catch {
      return { eligible: 0, suppressed: 0 };
    }
  }

  private async birthdayThisMonth(ctx: AiMarketingContext): Promise<EligibleAudience> {
    try {
      const month = new Date().getUTCMonth() + 1;
      const base = () => {
        let q = this.db.selectFrom('customers as c')
          .where('c.tenant_id', '=', ctx.tenantId)
          .where('c.archived_at', 'is', null)
          .where('c.marketing_sms_opt_in', '=', true)
          .where('c.birthday', 'is not', null)
          .where(sql<boolean>`extract(month from c.birthday) = ${month}`);
        if (ctx.branchId) q = q.where('c.branch_id', '=', ctx.branchId);
        return q;
      };
      const total = num((await base().select((eb: any) => eb.fn.count('c.id').as('n')).executeTakeFirst() as any)?.n);
      const eligible = num((await this.withUsableSms(base(), ctx).select((eb: any) => eb.fn.count('c.id').as('n')).executeTakeFirst())?.n);
      return { eligible, suppressed: Math.max(0, total - eligible) };
    } catch {
      return { eligible: 0, suppressed: 0 };
    }
  }

  // Aggregate-only preview built entirely from a validated AudienceDefinition — no raw predicates.
  // Branch is server-derived from ctx (never from the definition), preserving branch isolation.
  async previewAudience(ctx: AiMarketingContext, def: AudienceDefinition): Promise<AudiencePreview> {
    const upcomingFrom = businessDate(await branchTimeZone(this.db, ctx.tenantId, ctx.branchId ?? null));   // the salon's day
    const generatedAt = new Date().toISOString();
    const empty: AudiencePreview = {
      channel: def.channel, total: 0, eligible: 0, suppressed: 0,
      breakdown: { missingContact: 0, optedOut: 0 }, definitionEcho: def, generatedAt,
    };
    try {
      const consentCol = def.channel === 'sms' ? 'c.marketing_sms_opt_in' : 'c.marketing_email_opt_in';
      const contactCol = def.channel === 'sms' ? 'c.normalized_phone' : 'c.email';

      const base = () => {
        let q = this.db.selectFrom('customers as c')
          .where('c.tenant_id', '=', ctx.tenantId)
          .where('c.archived_at', 'is', null)
          .where(consentCol, '=', true);
        if (ctx.branchId) q = q.where('c.branch_id', '=', ctx.branchId);
        if (def.requireActiveStatus) q = q.where('c.status', '=', 'active');
        if (def.minDaysSinceLastCompletedVisit != null) {
          const cutoff = dateNDaysAgo(def.minDaysSinceLastCompletedVisit);
          q = q.where((eb: any) => eb.exists(
            eb.selectFrom('pos_tech_appointments as a').select('a.id')
              .whereRef('a.customer_id', '=', 'c.id')
              .where('a.tenant_id', '=', ctx.tenantId)
              .where('a.status', '=', 'completed')
              .where(sql<boolean>`a.appt_date < ${cutoff}::date`),
          ));
        }
        if (def.excludeWithFutureAppointment) {
          q = q.where((eb: any) => eb.not(eb.exists(
            eb.selectFrom('pos_tech_appointments as a2').select('a2.id')
              .whereRef('a2.customer_id', '=', 'c.id')
              .where('a2.tenant_id', '=', ctx.tenantId)
              .where('a2.status', 'in', UPCOMING_STATUSES as unknown as string[])
              .where('a2.appt_date', '>=', upcomingFrom)   /* the salon's day (Oct 3 2026 — was the database's UTC date) */,
          )));
        }
        if (def.birthdayMonth != null) {
          q = q.where('c.birthday', 'is not', null)
            .where(sql<boolean>`extract(month from c.birthday) = ${def.birthdayMonth}`);
        }
        return q;
      };

      const withContact = (q: any) => q.where((eb: any) => eb.and([
        eb(contactCol, 'is not', null), eb(contactCol, '<>', ''),
      ]));
      const notSuppressed = (q: any) => q.where((eb: any) => eb.not(eb.exists(
        eb.selectFrom('notification_opt_outs as o').select('o.address')
          .where('o.tenant_id', '=', ctx.tenantId)
          .where('o.channel', '=', def.channel)
          .whereRef('o.address', '=', contactCol),
      )));

      const total = num((await base().select((eb: any) => eb.fn.count('c.id').as('n')).executeTakeFirst() as any)?.n);
      const contactable = num((await withContact(base()).select((eb: any) => eb.fn.count('c.id').as('n')).executeTakeFirst())?.n);
      const eligible = num((await notSuppressed(withContact(base())).select((eb: any) => eb.fn.count('c.id').as('n')).executeTakeFirst())?.n);

      const missingContact = Math.max(0, total - contactable);
      const optedOut = Math.max(0, contactable - eligible);
      return {
        channel: def.channel, total, eligible, suppressed: Math.max(0, total - eligible),
        breakdown: { missingContact, optedOut }, definitionEcho: def, generatedAt,
      };
    } catch {
      return empty; // honest zero preview on failure — never a fabricated audience size
    }
  }

  // Add "has a usable phone AND is not on the SMS suppression list" to a customers-as-c query.
  private withUsableSms(q: any, ctx: AiMarketingContext): any {
    return q
      .where((eb: any) => eb.and([eb('c.normalized_phone', 'is not', null), eb('c.normalized_phone', '<>', '')]))
      .where((eb: any) => eb.not(eb.exists(
        eb.selectFrom('notification_opt_outs as o').select('o.address')
          .where('o.tenant_id', '=', ctx.tenantId)
          .where('o.channel', '=', 'sms')
          .whereRef('o.address', '=', 'c.normalized_phone'),
      )));
  }
}
