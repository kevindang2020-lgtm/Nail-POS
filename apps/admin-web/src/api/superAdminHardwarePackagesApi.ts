// superAdminHardwarePackagesApi.ts — typed client for the Super-Admin Hardware Packages surface (backend:
// @Controller('super-admin/hardware-packages')). One `state` call drives the page; the rest are actions.
import { useCallback, useEffect, useState } from 'react';
import { api } from './client';
import type { HwQuery } from '@aipowersalon/api-contracts/platform';   // the wire contract (Constitution 13 §15)

const enc = encodeURIComponent;
const qs = (q: object) => { const p = new URLSearchParams(); Object.entries(q as Record<string, unknown>).forEach(([k, v]) => { if (v != null && v !== '' && v !== 'all') p.set(k, String(v)); }); const s = p.toString(); return s ? `?${s}` : ''; };

export interface HwPackage {
  id: string; tenantId: string | null; salonName: string | null; salonCode: string | null; ownerName: string | null; city: string | null; state: string | null;
  packageName: string | null; packageType: string | null; status: string; paymentStatus: string; hardwareCostCents: number | null; depositCents: number | null; amountPaidCents: number | null; financingTerms: string | null;
  shippingAddress: string | null; shippingCity: string | null; shippingState: string | null; shippingZip: string | null; shippingCarrier: string | null; trackingNumber: string | null; trackingUrl: string | null;
  orderedAt: string | null; shippedAt: string | null; deliveredAt: string | null; installedAt: string | null; completedAt: string | null; cancelledAt: string | null; returnedAt: string | null;
  deviceCount?: number; createdAt: string; updatedAt: string;
}
export interface HwDetail { package: HwPackage; devices: { deviceType: string; deviceName: string; serialNumber: string | null; quantity: number }[]; notes: { id: string; note: string; createdAt: string }[]; normalizedStatus: string }
export interface HwState {
  summary: { totalPackages: number; notOrdered: number; readyToShip: number; shipped: number; delivered: number; installedComplete: number; pendingPayment: number; paidOff: number; trends: Record<string, number> };
  filters: Record<string, unknown>;
  packages: HwPackage[];
  pagination: { page: number; limit: number; totalItems: number; totalPages: number };
  packagesByStatus: { status: string; count: number; pct: number }[];
  topPackageTypes: { type: string; count: number; pct: number }[];
  recentHardwareActivity: { id: string; actionType: string; packageId: string | null; salonName: string | null; createdAt: string }[];
  recentHardwareEvents: { id: string; actionType: string; packageId: string | null; salonName: string | null; createdAt: string }[];
  selectedPackage: HwDetail | null;
  permissions: Record<string, boolean>;
  reference: { statuses: string[]; paymentStatuses: string[]; carriers: string[]; packageTypes: string[] };
}

export const hwApi = {
  state: (q: HwQuery = {}) => api.get<HwState>(`/super-admin/hardware-packages/state${qs(q)}`),
  detail: (id: string) => api.get<HwDetail>(`/super-admin/hardware-packages/${enc(id)}`),
  create: (b: Record<string, unknown>) => api.post(`/super-admin/hardware-packages`, b),
  update: (id: string, b: Record<string, unknown>) => api.patch(`/super-admin/hardware-packages/${enc(id)}`, b),
  setStatus: (id: string, status: string, force = false) => api.patch(`/super-admin/hardware-packages/${enc(id)}/status`, { status, force }),
  setPaymentStatus: (id: string, paymentStatus: string) => api.patch(`/super-admin/hardware-packages/${enc(id)}/payment-status`, { paymentStatus }),
  updateTracking: (id: string, b: Record<string, unknown>) => api.patch(`/super-admin/hardware-packages/${enc(id)}/tracking`, b),
  addDevices: (id: string, devices: unknown[]) => api.post(`/super-admin/hardware-packages/${enc(id)}/devices`, { devices }),
  addNote: (id: string, note: string) => api.post(`/super-admin/hardware-packages/${enc(id)}/notes`, { note }),
  cancel: (id: string, reason?: string) => api.post(`/super-admin/hardware-packages/${enc(id)}/cancel`, { reason }),
  returnPkg: (id: string, reason?: string) => api.post(`/super-admin/hardware-packages/${enc(id)}/return`, { reason }),
  listTenants: (search?: string) => api.get<{ id: string; name: string; code: string | null }[]>(`/super-admin/hardware-packages/tenants${qs({ search })}`),
  tenantHardware: (tenantId: string) => api.get<{ package: HwPackage | null; devices?: { deviceName: string; quantity: number }[]; normalizedStatus?: string }>(`/super-admin/tenants/${enc(tenantId)}/hardware`),
  async downloadCsv(q: HwQuery = {}) {
    const csv = await api.exportAsync<string>(`/super-admin/hardware-packages/export`, q as Record<string, unknown>, 'text');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `hardware-packages-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  },
};

export function useSuperAdminHardwareState(query: HwQuery) {
  const [state, setState] = useState<HwState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(query);
  const load = useCallback(() => {
    setLoading(true);
    hwApi.state(query).then((s) => { setState(s); setError(null); }).catch((e: any) => setError(e?.status === 403 ? 'You do not have permission to view hardware packages.' : e?.message || 'Failed to load hardware packages.')).finally(() => setLoading(false));
     
  }, [key]);
  useEffect(load, [load]);
  return { state, loading, error, reload: load };
}
export type { HwQuery };
