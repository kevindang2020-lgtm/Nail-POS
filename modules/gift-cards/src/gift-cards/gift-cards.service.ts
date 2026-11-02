// gift-cards.service.ts — read-only management state for the tenant's gift cards.
import { buildGiftCardsSummary, buildBranchLiability, type GiftCardsContext, type GiftCardsState, type GiftCardLiabilityReport } from './gift-cards.dto';
import { hasPermission } from '@aipowersalon/permissions';
import { businessDate } from '@aipowersalon/date-time';
import type { GiftCardsRepositoryPort } from './gift-cards.repository';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export class ForbiddenError extends Error {}
export class GiftCardsValidationError extends Error {}
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export class GiftCardsService {
  constructor(private readonly repo: GiftCardsRepositoryPort) {}

  async getState(ctx: GiftCardsContext): Promise<GiftCardsState> {
    if (!ctx?.userId || !ctx?.tenantId) throw new ForbiddenError('Not authenticated');
    const [cards, kpis] = await Promise.all([this.repo.listCards(ctx), this.repo.summaryAggregate ? this.repo.summaryAggregate(ctx) : Promise.resolve(null)]);
    return { kpis: kpis ?? buildGiftCardsSummary(cards), cards };
  }

  /** Decision 31: per-branch sold / redeemed / net clearing for [from, to], plus what the tenant owes card holders now.
   *  A financial report across every branch — reports permission, not the checkout one. */
  async getLiability(ctx: GiftCardsContext, q: { from?: string; to?: string } = {}): Promise<GiftCardLiabilityReport> {
    if (!ctx?.userId || !ctx?.tenantId) throw new ForbiddenError('Not authenticated');
    if (!hasPermission(ctx as any, 'pos.reports.view')) throw new ForbiddenError('Missing pos.reports.view');
    const tz = (await this.repo.timeZone?.(ctx).catch(() => undefined)) || 'America/New_York';   // the requesting branch's days (Oct 2 2026)
    const today = businessDate(tz);
    const to = q.to || today; const from = q.from || to.slice(0, 8) + '01';
    if (!ISO.test(from) || !ISO.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) throw withCode(new GiftCardsValidationError('Dates must be YYYY-MM-DD'), 'DATE_INVALID');
    if (from > to) throw withCode(new GiftCardsValidationError('The start date is after the end date'), 'DATE_RANGE_INVALID');
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) throw withCode(new GiftCardsValidationError('Choose a range of a year or less'), 'DATE_RANGE_TOO_LARGE');
    if (!this.repo.ledgerRows || !this.repo.outstandingLiabilityCents || !this.repo.branchNames) throw new Error('Gift-card liability is not available');
    const [rows, outstanding, names] = await Promise.all([this.repo.ledgerRows(ctx, from, to, tz), this.repo.outstandingLiabilityCents(ctx), this.repo.branchNames(ctx)]);
    return { from, to, outstandingLiabilityCents: outstanding, ...buildBranchLiability(rows, names) };
  }
}
