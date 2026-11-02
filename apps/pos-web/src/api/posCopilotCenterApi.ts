// posCopilotCenterApi — AI Center → Reception Copilot (/pos/ai/copilot-center/*). Reception Copilot Complete Build Guide:
// prepare (no side effect, server preview + sealed confirmation token) → confirm (the exact reviewed action, verified from
// the persisted record), live status strip, Copilot activity history, scoped search, Check Copilot System, the Smart
// Front Desk Priority Assistant and the customer reception overlay. Tenant / branch come from the session.
import { api } from './client';
const enc = encodeURIComponent;
const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as Record<string, string | number>;

export type CcActionType = 'create_appointment' | 'reschedule_appointment' | 'cancel_appointment' | 'send_message';
export type CcAction = { type: CcActionType } & Record<string, unknown>;
export interface CcPrepared {
  state: 'awaiting_confirmation' | 'blocked'; title: string; type: CcActionType;
  current: Record<string, unknown> | null; proposed: Record<string, unknown>;
  warnings: string[]; notices: string[]; blocked: string[]; token: string | null; expiresAt: string | null;
}
export interface CcConfirmed {
  ok: boolean; requestKey: string; errorCode: string | null; message: string | null; duplicate: boolean;
  state: string; record: Record<string, unknown> | null;
}
export type CcActivityQuery = { q?: string; state?: string; type?: string; period?: string; from?: string; to?: string; page?: number; pageSize?: number };

export const posCopilotCenterApi = {
  overview: () => api.get<any>('/pos/ai/copilot-center/overview'),
  prepare: (action: CcAction) => api.post<CcPrepared>('/pos/ai/copilot-center/actions/prepare', { action }),
  confirm: (action: CcAction, token: string) => api.post<CcConfirmed>('/pos/ai/copilot-center/actions/confirm', { action, token }),
  activity: (q: CcActivityQuery) => api.get<any>('/pos/ai/copilot-center/activity', clean(q)),
  search: (q: { scope: string; q?: string; page?: number; pageSize?: number }) => api.get<any>('/pos/ai/copilot-center/search', clean(q)),
  health: () => api.post<any>('/pos/ai/copilot-center/health', {}),
  priorities: () => api.get<any>('/pos/ai/copilot-center/priorities'),
  customer: (id: string) => api.get<any>(`/pos/ai/copilot-center/customers/${enc(id)}`),
};
