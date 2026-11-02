// ai-voice-transcription.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in ai-voice-transcription.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const VoiceTranscriptionControllerListQueries = {
  unresolved: { search: false },
  list: { filters: { status: { type: 'text' }, branchId: { type: 'id' }, customerId: { type: 'id' }, direction: { type: 'text' } }, search: false, dirParams: [] },
  search: { filters: { intent: { type: 'text' }, customerId: { type: 'id' }, branchId: { type: 'id' }, direction: { type: 'text' }, language: { type: 'text' }, status: { type: 'text' } }, dirParams: [], dateRange: { maxDays: 'analytics', from: ['dateFrom'], to: ['dateTo'] } },
} satisfies Record<string, ListQuerySpec>;
