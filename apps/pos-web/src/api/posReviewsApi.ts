// posReviewsApi.ts — tenant reviews / reputation. Permission-gated server-side
// (pos.marketing.view read, pos.marketing.manage write).
import { api } from "./client";
export const posReviewsApi = {
  state: () => api.get(`/pos/reviews/state`),
  setVisibility: (id: string, hidden: boolean, reason: string | null) => api.post(`/pos/reviews/${id}/visibility`, { hidden, reason }),
};
