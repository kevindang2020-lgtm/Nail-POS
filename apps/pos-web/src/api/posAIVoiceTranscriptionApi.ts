// posAIVoiceTranscriptionApi.ts — AI Voice Transcription (read + advisory). Tenant/branch are server-derived from
// the session; the client never sends a tenantId. Transcripts returned are REDACTED; raw is a separate gated call.
import { api } from './client';

export const posAIVoiceTranscriptionApi = {
  overview: () => api.get(`/pos/ai-voice-transcription/overview`),
  getSettings: () => api.get(`/pos/ai-voice-transcription/settings`),
  /** Voice Transcription Settings guide (Nov 2026): send the changed fields + `expectedVersion`; a sensitive change (shorter
   *  retention, raw text on / off, transcription off) answers 409 VT_CONFIRM_REQUIRED with its impact — resend with confirm: true */
  updateSettings: (patch: Record<string, unknown>) => api.put(`/pos/ai-voice-transcription/settings`, patch),
  // Voice Transcription Follow-Ups guide (Nov 2026): the review queue over extracted call items (replaces GET unresolved).
  // A task goes into the ONE task system (/pos/ai/follow-ups-center); dismiss / reopen need a reason.
  followUps: {
    summary: () => api.get<any>(`/pos/ai-voice-transcription/follow-ups/summary`),
    items: (q: Record<string, string | number | undefined> = {}) => api.get<any>(`/pos/ai-voice-transcription/follow-ups/items`, Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '')) as Record<string, string | number>),
    history: (transcriptId: string, type: string) => api.get<any>(`/pos/ai-voice-transcription/follow-ups/items/history`, { transcriptId, type }),
    task: (b: { transcriptId: string; type: string; priority?: string; dueLocal?: string | null; assignedUserId?: string | null; note?: string | null }) => api.post<any>(`/pos/ai-voice-transcription/follow-ups/items/task`, b),
    dismiss: (b: { transcriptId: string; type: string; reason: string }) => api.post<any>(`/pos/ai-voice-transcription/follow-ups/items/dismiss`, b),
    reopen: (b: { transcriptId: string; type: string; reason: string }) => api.post<any>(`/pos/ai-voice-transcription/follow-ups/items/reopen`, b),
    check: () => api.post<any>(`/pos/ai-voice-transcription/follow-ups/check`, {}),
  },
  // the settings page's read side: status row · Records · Check Voice Transcription Settings
  center: {
    summary: () => api.get<any>(`/pos/ai-voice-transcription/center/summary`),
    records: (q: Record<string, string | number | undefined> = {}) => api.get<any>(`/pos/ai-voice-transcription/center/records`, Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '')) as Record<string, string | number>),
    check: () => api.post<any>(`/pos/ai-voice-transcription/center/check`, {}),
  },
  list: (q: Record<string, string | number | undefined> = {}) => {
    const qs = Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
    return api.get(`/pos/ai-voice-transcription/transcripts${qs ? `?${qs}` : ''}`);
  },
  detail: (id: string) => api.get(`/pos/ai-voice-transcription/transcripts/${id}`),
  intelligence: (id: string) => api.get(`/pos/ai-voice-transcription/transcripts/${id}/intelligence`),
  generateSummary: (id: string) => api.post(`/pos/ai-voice-transcription/transcripts/${id}/summary`, {}),
  search: (q: Record<string, string | number | undefined> = {}) => {
    const qs = Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
    return api.get(`/pos/ai-voice-transcription/transcripts/search${qs ? `?${qs}` : ''}`);
  },
};
