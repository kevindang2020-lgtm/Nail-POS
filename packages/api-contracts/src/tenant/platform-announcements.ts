// platform-announcements.ts (tenant realm) — what a POS receives about Platform Announcements (Super Admin POS Top-Bar
// mandate, Oct 22 2026, §66): ONLY the client-safe fields — never the audience, the target list or platform-admin data.
// Server: modules/communications platform-announcements (GET /pos/platform-announcements/active). Client: pos-web.
export type PlatformAnnouncementType = 'info' | 'update' | 'maintenance' | 'warning' | 'urgent';
export type PlatformAnnouncementPriority = 'low' | 'normal' | 'high' | 'critical';

export interface PosPlatformAnnouncement {
  id: string; title: string | null; message: string; type: PlatformAnnouncementType; priority: PlatformAnnouncementPriority;
  /** English + Vietnamese POS mandate WP-F (§56): the Vietnamese version a person wrote (null = English only / none).
   *  The POS picks with `announcementText` — no refetch on a language switch. */
  titleVi: string | null; messageVi: string | null;
  dismissible: boolean; requiresAcknowledgement: boolean; acknowledged: boolean;
  startsAt: string | null; endsAt: string | null; version: number; contentVersion: number;
}
/** The startup / reconnect / safety-sync snapshot: everything this signed-in employee should see now, highest first, and
 *  the next instant something scheduled starts or ends (the POS refetches then — no browser refresh). */
export interface PosPlatformAnnouncementSnapshot { announcements: PosPlatformAnnouncement[]; serverTime: string; nextChangeAt: string | null }
export interface PosPlatformAnnouncementReceiptRequest { contentVersion: number }
export interface PosPlatformAnnouncementReceiptResult { id: string; kind: 'delivered' | 'dismissed' | 'acknowledged'; contentVersion: number; recorded: boolean }

/** WP-F (§56): what a POS shows in its CURRENT language — the Vietnamese text when the POS is Vietnamese and a Vietnamese
 *  version exists, otherwise the English text. Pure, so a language switch re-renders without a network call. */
export function announcementText(a: { title: string | null; message: string; titleVi?: string | null; messageVi?: string | null }, language: string): { title: string | null; message: string; language: 'en' | 'vi' } {
  if (language === 'vi' && a.messageVi) return { title: a.titleVi ?? null, message: a.messageVi, language: 'vi' };
  return { title: a.title, message: a.message, language: 'en' };
}
