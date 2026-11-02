// posReferralsApi.ts — the legacy referral program state (/pos/referrals/state), read by the Marketing & Growth dashboard tile.
// The Referral Program page itself uses posReferralProgramApi (/pos/referral-program/*): recording goes through the ONE canonical
// record path there, and the old hand-typed "reward" toggle is retired (guide §10 — never "paid" from a status toggle).
import { api } from "./client";
export const posReferralsApi = {
  state: () => api.get<any>(`/pos/referrals/state`),
};
