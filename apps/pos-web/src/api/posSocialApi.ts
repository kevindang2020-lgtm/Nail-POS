// posSocialApi.ts — social content planner (real /pos/social-posts). Plan/track only; no platform publishing.
import { api } from "./client";
export const posSocialApi = {
  state: () => api.get<any>(`/pos/social-posts/state`),
  create: (body: { platform: string; caption: string; scheduledAt?: string | null }) => api.post<any>(`/pos/social-posts`, body),
  setStatus: (id: string, status: string) => api.post<any>(`/pos/social-posts/${encodeURIComponent(id)}/status`, { status }),
};
