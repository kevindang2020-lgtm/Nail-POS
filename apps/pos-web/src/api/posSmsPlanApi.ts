// posSmsPlanApi.ts — tenant self-service SMS plan (sms-packages P5). §43-safe payload only.
import { api } from './client';

export type SmsMessagingUsage = { periodStart: string; periodEnd: string; messages: number; segments: number; delivered: number; failed: number; unknownSegments: number };

export interface SmsSelfServicePackage {
  id: string; code: string; name: string; description: string | null;
  monthlyPriceCents: number; includedVerificationCount: number;
  overageEnabled: boolean; overageUnitPriceCents: number; hardLimitEnabled: boolean;
}
export type SmsBalance = { hasPackage: false } | {
  hasPackage: true; packageName: string; packageCode: string; cycleStart: string; cycleEnd: string;
  includedAllowance: number; usedIncluded: number; remainingIncluded: number;
  overageCount: number; overageUnitPriceCents: number; overageEnabled: boolean; hardLimitEnabled: boolean;
  failedCount: number; estimatedOverageCents: number;
  warningThresholdPercent: number; criticalThresholdPercent: number;
  monthlyPriceCents: number;
};

export const posSmsPlanApi = {
  // wave 3 PAYI §76/§77: `messaging` = plain-SMS SEGMENT usage this month (null without a database) — separate from the verification balance
  plan: () => api.get<{ balance: SmsBalance; packages: SmsSelfServicePackage[]; messaging?: SmsMessagingUsage | null }>('/tenant/sms-plan'),
  upgrade: (packageId: string) => api.post<{ ok: true; effective: string } | { ok: false; error: string; message?: string }>('/tenant/sms-plan/upgrade', { packageId }),
};
