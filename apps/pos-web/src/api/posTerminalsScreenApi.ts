// posTerminalsScreenApi.ts — Payment Terminals mandate (Oct 29 2026): the READ side of Devices → Payment Terminals
// (/pos/devices/payment-terminals*, pos.checkout.view). Lists are filtered, sorted and paged on the server over the salon's
// whole inventory; the KPIs are the live inventory (never redefined by the activity date range). The mutations stay on
// their audited step-up routes: posDevicesApi (pair · register · test · rename · disable / enable · unpair),
// posMobilePaymentsApi (approve · suspend · revoke · rename · locations), posSettingsApi (capture routing).
import { api } from './client';
type Q = Record<string, unknown>;
const clean = (q: Q) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== ''));
const B = '/pos/devices/payment-terminals';
const e = encodeURIComponent;
export const posTerminalsScreenApi = {
  summary: () => api.get<any>(`${B}/summary`),
  physical: (q: Q) => api.get<any>(`${B}/physical`, clean(q)),
  physicalDetail: (id: string) => api.get<any>(`${B}/physical/${e(id)}`),
  phones: (q: Q) => api.get<any>(`${B}/tap-to-pay`, clean(q)),
  phoneDetail: (deviceId: string) => api.get<any>(`${B}/tap-to-pay/${e(deviceId)}`),
  activity: (q: Q) => api.get<any>(`${B}/activity`, clean(q)),
  routing: () => api.get<any>(`${B}/routing`),
  audit: (q: Q) => api.get<any>(`${B}/audit`, clean(q)),
};
