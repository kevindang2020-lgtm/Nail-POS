// posAIVoiceTranscriptionApi.ts — AI Voice Transcription (read + advisory). Tenant/branch are server-derived from
// the session; the client never sends a tenantId. Transcripts returned are REDACTED; raw is a separate gated call.
import { api } from './client';

export const posAIVoiceTranscriptionApi = {
  overview: () => api.get(`/pos/ai-voice-transcription/overview`),
  unresolved: () => api.get(`/pos/ai-voice-transcription/unresolved`),
  getSettings: () => api.get(`/pos/ai-voice-transcription/settings`),
  /** Voice Transcription Settings guide (Nov 2026): send the changed fields + `expectedVersion`; a sensitive change (shorter
   *  retention, raw text on / off, transcription off) answers 409 VT_CONFIRM_REQUIRED with its impact — resend with confirm: true */
  updateSettings: (patch: Record<string, unknown>) => api.put(`/pos/ai-voice-transcription/settings`, patch),
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
