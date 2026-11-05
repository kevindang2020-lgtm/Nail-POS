// use-pos-language.ts — applies the POS language for whoever is signed in (Vietnamese POS mandate §8, WP-B). Mounted once in
// the app root (App.tsx Gate), which stays mounted across sign-in / sign-out:
//   signed in  → GET pos/me/locale → user's choice ?? salon default ?? English (i18n/pos-language.ts), applied in place
//   signed out → English
// No reload, no remount: the roots subscribe to the language (useLanguage) and re-render.
import { useEffect } from 'react';
import { setBusinessTimeZone } from '@aipowersalon/mobile-sdk/i18n';
import { api } from '../api/client';
import { loadPosLanguage, resetPosLanguage } from './pos-language';

export function usePosLanguage(signedInUserId: string | null | undefined): void {
  useEffect(() => {
    if (!signedInUserId) { resetPosLanguage(); return; }
    // the same answer carries the branch's time zone (i18n/format.ts: dates follow the branch, never the language)
    void loadPosLanguage(signedInUserId, () => api.get<{ language: 'en' | 'vi' | null; timeZone?: string | null }>('/pos/me/locale')
      .then((r) => { if (r?.timeZone) setBusinessTimeZone(r.timeZone); return r; }));
  }, [signedInUserId]);
}
