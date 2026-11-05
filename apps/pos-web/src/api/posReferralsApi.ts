// posReferralsApi.ts — salon referral program (real /pos/referrals): program state, record a referral, reward.
import { api } from "./client";
export const posReferralsApi = {
  state: () => api.get<any>(`/pos/referrals/state`),
  record: (code: string, referredCustomerId: string) => api.post<any>(`/pos/referrals/record`, { code, referredCustomerId }),
  reward: (id: string, rewardCents: number) => api.post<any>(`/pos/referrals/${encodeURIComponent(id)}/reward`, { rewardCents }),
};
