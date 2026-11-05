// tenants.ts — wire contract (Constitution 13 §13, §15). Realm: tenant. Moved from the server's own declaration so the
// server and every app use ONE definition.

export interface GeocodeHit {
  formattedAddress: string; latitude: number; longitude: number;
  placeId: string | null; accuracy: string | null;
  city: string | null; state: string | null; zip: string | null; country: string | null;
}
export interface MessageTemplate { id: string; channel: 'sms' | 'email'; name: string; body: string; }
