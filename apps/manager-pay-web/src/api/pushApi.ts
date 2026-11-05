// pushApi.ts — device push-token registration for this app (POST /push/register|unregister). The `app` field routes
// the APNs topic server-side (APNS_TOPIC_MANAGER); keep it in sync with the backend's per-app topic env keys.
import { api } from './client';

export const pushApi = {
  registerPush: (platform: 'ios' | 'android' | 'web', token: string) => api.post<{ ok: true }>('/push/register', { platform, token, app: 'manager' }),
  unregisterPush: (token: string) => api.post<{ ok: true }>('/push/unregister', { token }),
};
