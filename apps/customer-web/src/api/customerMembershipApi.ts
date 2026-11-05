import { api } from './client';

export interface MemberBenefit {
  benefitId: string;
  label: string;
  benefitType: string;
  serviceId: string | null;
  serviceCreditsAvailable: number;
  dollarCreditsAvailableCents: number;
}

export interface AvailableMembershipPlan {
  planId: string;
  planVersionId: string;
  name: string;
  planCode: string | null;
  description: string | null;
  badge: string | null;
  isPopular: boolean;
  isFeatured: boolean;
  priceCents: number;
  billingInterval: string;
  intervalCount: number;
  enrollmentFeeCents: number;
  benefits: Array<{
    benefitId: string;
    label: string;
    benefitType: string;
    creditsPerCycle: number;
    valueCents: number;
  }>;
}

export interface CustomerMembershipView {
  hasMembership: boolean;
  membership: { membershipId: string; planName: string | null; status: string; memberNumber: string | null; nextBillingAt: string | null; startedAt: string | null } | null;
  benefits: MemberBenefit[];
  availablePlans?: AvailableMembershipPlan[];
}

export const customerMembershipApi = {
  membership: () => api.get<CustomerMembershipView>('/customer/membership'),
  join: (planId: string, planVersionId?: string) => api.post<{ membershipId: string; memberNumber: string; status: string }>('/customer/membership/join', { planId, planVersionId }),
};
