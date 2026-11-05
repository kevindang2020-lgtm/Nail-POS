// platform-search.ts — wire contract (Constitution 13 §15). Realm: platform. Constitution 7 §140–§141.
export type PlatformSearchKind = 'tenant' | 'branch' | 'platform_user' | 'support_ticket';
export interface PlatformSearchHit { kind: PlatformSearchKind; id: string; title: string; subtitle: string | null; tenantId: string | null }
export interface PlatformSearchResult { q: string; groups: Array<{ kind: PlatformSearchKind; hits: PlatformSearchHit[] }>; hidden: PlatformSearchKind[] }
