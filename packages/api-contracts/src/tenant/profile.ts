// profile.ts — wire contract (Constitution 13 §13, §15). Realm: tenant. Moved from the server's own declaration so the
// server and every app use ONE definition.

export interface SignInSession { id: string; device: string; ip: string | null; signedInAt: string; status: 'active' | 'expired' | 'revoked'; active: boolean; }
