import { api } from './client';

import type { PosAccountOverview } from '@aipowersalon/api-contracts/tenant';
export type { PosAccountOverview };

export const posAccountApi = {
  overview: () => api.get<PosAccountOverview>('/pos/account/overview'),
};
