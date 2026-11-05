// GENERATED FROM apps/api by tooling/contracts/move-contracts.py, then OWNED HERE (Constitution 13 §13).
// Realm: customer. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

export interface NearbyDealCard extends Omit<NearbyDealRow, 'latitude' | 'longitude'> {
  distanceMiles: number | null; savingsCents: number | null;
}

export interface NearbyDealRow {
  id: string; title: string; shortDescription: string | null; imageUrl: string | null;
  ownerType: 'salon' | 'technician'; technicianId: string | null; technicianName: string | null;
  discountType: 'percent' | 'fixed'; discountPercent: number | null; discountCents: number | null;
  originalPriceCents: number | null; finalPriceCents: number | null; endsAt: string | null;
  branchId: string; branchName: string | null; address: string | null; salonName: string | null;
  latitude: number | null; longitude: number | null;
}
