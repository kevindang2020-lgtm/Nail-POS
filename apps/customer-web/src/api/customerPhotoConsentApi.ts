// customerPhotoConsentApi.ts — the customer app client for viewing and withdrawing consent for their own published
// before/after & service photos (/customer/my-photo-consents). The server resolves the customer from the session and
// only ever returns/touches consents that belong to them.
import { api } from './client';

export interface MyConsentedPhoto {
  photoId: string;
  imageUrl: string;
  thumbnailUrl: string | null;
  caption: string | null;
  approvedUses: string[];
  publicBlocked: boolean;
  consentedAt: string;
}

export const customerPhotoConsentApi = {
  list: () => api.get<{ photos: MyConsentedPhoto[] }>('/customer/my-photo-consents'),
  withdraw: (photoId: string) => api.post<{ ok: boolean; photoId: string }>(`/customer/my-photo-consents/${encodeURIComponent(photoId)}/withdraw`, {}),
};
