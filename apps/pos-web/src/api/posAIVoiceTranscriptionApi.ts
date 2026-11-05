// posAIVoiceTranscriptionApi.ts — AI Voice Transcription (read + advisory). Tenant/branch are server-derived from
// the session; the client never sends a tenantId. Transcripts returned are REDACTED; raw is a separate gated call.
import { api } from './client';

export const posAIVoiceTranscriptionApi = {
  overview: () => api.get(`/pos/ai-voice-transcription/overview`),
  unresolved: () => api.get(`/pos/ai-voice-transcription/unresolved`),
  getSettings: () => api.get(`/pos/ai-voice-transcription/settings`),
  updateSettings: (patch: Record<string, unknown>) => api.put(`/pos/ai-voice-transcription/settings`, patch),
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
