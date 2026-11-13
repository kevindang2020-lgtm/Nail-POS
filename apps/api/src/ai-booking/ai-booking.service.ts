// ai-booking.service.ts — the shared AI Booking orchestration facade. It does NOT compute availability, hold a second
// appointment store, or mutate tables. It resolves trusted context, delegates to the authoritative BookingService (and
// the Copilot ranking intelligence), bounds every result, stamps the booking source, and records conversion. Mutations
// (create/reschedule/cancel) reuse the Copilot action spine and land in the next stage; this stage is read-orchestration.
import { Injectable, Optional } from '@nestjs/common';
import { BookingService } from '@aipowersalon/booking';
import { ReceptionCopilotContextService } from '@aipowersalon/ai';
import { AiBookingConversionService } from './ai-booking-conversion.service';
import { domainSourceFor } from './ai-booking-source';
import type { AiBookingContext } from './ai-booking-context';
import type { BookingTechnicianSummary } from '@aipowersalon/api-contracts/tenant';

const MAX_TECHNICIANS = 8;
const MAX_SLOTS_PER_TECH = 12;

/** round 10 (AI Booking 03): the qualified-technicians answer — Booking's own projection fields, nothing more */
export interface AiBookingQualifiedTechs { technicians: Pick<BookingTechnicianSummary, 'technicianId' | 'name'>[]; total: number; bounded: boolean; correlationId: string }
export interface AvailabilitySearchInput { date?: string; serviceIds?: string[]; technicianId?: string }
export interface AvailabilityOption { technicianId: string; technicianName: string; slots: string[] }
export interface AvailabilityResult { source: string; domainSource: string; branchId: string | null; options: AvailabilityOption[]; bounded: boolean; correlationId: string }

@Injectable()
export class AiBookingService {
  constructor(
    private readonly booking: BookingService,
    @Optional() private readonly copilot?: ReceptionCopilotContextService,
    @Optional() private readonly conversion?: AiBookingConversionService,
  ) {}

  private bctx(ctx: AiBookingContext) {
    return { tenantId: ctx.tenantId, branchId: ctx.branchId ?? undefined, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions } as any;
  }

  /** The services this context may book (the engine's catalog — the ids create() accepts). */
  async services(ctx: AiBookingContext): Promise<{ serviceId: string; name: string; durationMinutes: number; priceCents: number }[]> {
    return this.booking.catalog(this.bctx(ctx));
  }

  /** round 10 (AI Booking 03): the technicians approved for EVERY requested service and working that day — the booking
   *  engine's ONE eligibility authority (technicianPage serviceIds + working), one bounded page; never an own skill rule. */
  async qualifiedTechnicians(ctx: AiBookingContext, input: { serviceIds?: string[]; date?: string }): Promise<AiBookingQualifiedTechs> {
    const page = await this.booking.technicianPage(this.bctx(ctx), { serviceIds: input.serviceIds, date: input.date, working: true, status: 'active', page: 1, pageSize: MAX_TECHNICIANS * 3 });
    const items = (page?.items ?? []).map((t) => ({ technicianId: t.technicianId, name: t.name }));
    const total = Number(page?.total ?? items.length);
    return { technicians: items, total, bounded: total > items.length, correlationId: ctx.correlationId };
  }

  /** Search real availability via the authoritative engine; bounded + source-stamped; records the funnel. */
  async searchAvailability(ctx: AiBookingContext, input: AvailabilitySearchInput): Promise<AvailabilityResult> {
    const started = Date.now();
    const raw = await this.booking.availability(this.bctx(ctx), { date: input.date, serviceIds: input.serviceIds, technicianId: input.technicianId, branchId: ctx.branchId ?? undefined });
    const full = Array.isArray(raw) ? raw : [];
    const options: AvailabilityOption[] = full.slice(0, MAX_TECHNICIANS).map((t: any) => ({
      technicianId: t.technicianId, technicianName: t.name, slots: (t.slots || []).slice(0, MAX_SLOTS_PER_TECH),
    }));
    const bounded = full.length > MAX_TECHNICIANS || full.some((t: any) => (t.slots || []).length > MAX_SLOTS_PER_TECH);
    await this.conversion?.record(ctx, { stage: 'AVAILABILITY_SEARCHED', latencyMs: Date.now() - started });
    return { source: ctx.source, domainSource: domainSourceFor(ctx.source), branchId: ctx.branchId, options, bounded, correlationId: ctx.correlationId };
  }

  /** Retrieve a single appointment, tenant/branch scoped, via the authoritative engine (§36 GET /appointments/:id). */
  async getAppointment(ctx: AiBookingContext, appointmentId: string): Promise<any> {
    return this.booking.detail(this.bctx(ctx), appointmentId);
  }

  /** Ranked booking recommendations, reusing the Copilot's availability/technician intelligence when present. */
  async recommendOptions(ctx: AiBookingContext, input: { date?: string; serviceIds?: string[]; technicianId?: string }): Promise<any> {
    if (!this.copilot) {
      const av = await this.searchAvailability(ctx, input);
      await this.conversion?.record(ctx, { stage: 'OPTIONS_PRESENTED' });
      return { source: ctx.source, availability: av, recommendations: null, correlationId: ctx.correlationId };
    }
    const cctx = { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions };
    const [availability, technicians] = await Promise.all([
      this.copilot.recommendAvailability(cctx, { date: input.date, serviceIds: input.serviceIds, technicianId: input.technicianId }),
      this.copilot.recommendTechnicians(cctx, { serviceIds: input.serviceIds, date: input.date }),
    ]);
    await this.conversion?.record(ctx, { stage: 'OPTIONS_PRESENTED' });
    return { source: ctx.source, availability, technicians, correlationId: ctx.correlationId };
  }
}
