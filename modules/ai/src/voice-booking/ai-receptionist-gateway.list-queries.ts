// ai-receptionist-gateway.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in ai-receptionist-gateway.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const AiReceptionistGatewayControllerListQueries = {
  services: { filters: { requestId: { type: 'text' } }, search: false },
  // an integration-facing read: the handler itself bounds the window (startDate falls back to today, days to 1..14, §9)
  hours: { filters: { startDate: { type: 'text', maxLength: 32 }, days: { type: 'text', maxLength: 4 }, requestId: { type: 'text' } }, search: false },
  availability: { filters: { serviceId: { type: 'id' }, date: { type: 'text', maxLength: 32 }, technicianId: { type: 'id' }, requestId: { type: 'text' } }, search: false },
  getAppointment: { filters: { phone: { type: 'text' }, name: { type: 'text' }, requestId: { type: 'text' } }, search: false },
} satisfies Record<string, ListQuerySpec>;
