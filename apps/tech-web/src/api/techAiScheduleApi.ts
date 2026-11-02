// techAiScheduleApi.ts — BUILD_PLAN Phase 7 (ai_scheduling_optimizer): proposed / applied schedule changes that touch the
// signed-in technician (GET /tech/ai-schedule/changes?date=, the tech session — agent B's route). Read-only: technicians
// see what the optimizer suggests or changed for them; managers decide on the POS. Shapes are the API's own.
import { api } from './client';
import type { SchedTechChange, SchedTechChangeList } from '@aipowersalon/api-contracts/tenant';

export type { SchedTechChange, SchedTechChangeList };
export const techAiScheduleApi = {
  changes: (date: string) => api.get<SchedTechChangeList>('/tech/ai-schedule/changes', { date }).then((r) => (Array.isArray(r?.items) ? r.items : [])),
};
