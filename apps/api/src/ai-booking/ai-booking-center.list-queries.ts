// ai-booking-center.list-queries.ts — A7 AI Booking Assistant guide (Nov 4 2026): the declared filters, search and date range of the list
// endpoints in ai-booking-center.controller.ts (@ListQueries on the controller). Unknown filter[x] → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const AiBookingCenterControllerListQueries = {
  overview: { filters: { preset: { type: 'text' } }, search: false, dateRange: { maxDays: 366 } },
  activity: { filters: { status: { type: 'text' }, source: { type: 'text' }, technicianId: { type: 'text' }, basis: { type: 'text' }, preset: { type: 'text' } }, search: { params: ['q'] }, maxLimit: 50, dateRange: { maxDays: 366 }, params: ['page'] },
} satisfies Record<string, ListQuerySpec>;
