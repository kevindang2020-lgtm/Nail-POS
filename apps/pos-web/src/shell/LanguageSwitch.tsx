// LanguageSwitch.tsx — the POS topbar's language selector (Oct 21 2026; rebuilt Oct 26 2026 for the Vietnamese POS mandate
// §5–§7, §11, WP-B). A globe + the current language ("English" / "Tiếng Việt") opens a two-item menu. Picking a language
// changes THIS person's POS at once — no reload, no remount, no route reset: every screen keeps its selection, forms,
// filters, realtime connection and any in-progress payment (the roots subscribe to the language and re-render in place).
// The choice is saved on the person's login row (PUT pos/me/language) so it follows them to another register; the salon's
// default for staff who never chose is Settings → Business → "POS language" (a separate admin action, §12). If the server
// refuses the save the switch is rolled back and a short notice says so; offline, the choice is kept and saved later.
// Language names are shown in their own language (endonyms) whatever the current language is.
import { useEffect, useRef, useState } from 'react';
import { useLanguage, t } from '@aipowersalon/mobile-sdk/i18n';
import type { AppLanguage } from '@aipowersalon/api-contracts';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { switchPosLanguage } from '../i18n/pos-language';

export const LANGUAGE_LABEL = { en: 'English', vi: 'Tiếng Việt' } as const;
const ORDER: AppLanguage[] = ['en', 'vi'];

function Globe() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 010 18M12 3a14 14 0 000 18" />
    </svg>
  );
}

export function LanguageSwitch() {
  const lang = useLanguage();
  const { principal } = useAuth();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<AppLanguage | null>(null);   // the language we rolled back to (text built at render)
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(id);
  }, [notice]);

  const pick = (next: AppLanguage) => {
    setOpen(false);
    setNotice(null);
    if (next === lang) return;
    void switchPosLanguage(next, { userId: principal?.userId, put: (l) => api.put('/pos/me/language', { language: l }) })
      .then((r) => { if (!r.ok) setNotice(r.previous); });
  };

  return (
    <div className="topctl lang-switch">
      <button
        ref={btn}
        type="button"
        className="ic-btn"
        style={{ width: 'auto', minWidth: 44, padding: '0 10px', gap: 6, display: 'flex', alignItems: 'center', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('nav.language.menu', { current: LANGUAGE_LABEL[lang] })}
        title={t('pos.language')}
        onClick={() => setOpen((v) => !v)}
        data-testid="language-switch"
      >
        <Globe />
        <span data-testid="language-current" lang={lang}>{LANGUAGE_LABEL[lang]}</span>
      </button>
      {open && (
        <>
          <div className="ovbg" onClick={() => setOpen(false)} />
          <div className="notif-panel" role="menu" aria-label={t('pos.language')} style={{ width: 200 }}>
            {ORDER.map((l) => (
              <button
                key={l}
                type="button"
                role="menuitemradio"
                aria-checked={l === lang}
                lang={l}
                className="panel-row"
                style={{ minHeight: 44, fontWeight: l === lang ? 800 : 600 }}
                onClick={() => pick(l)}
                data-testid={`language-option-${l}`}
              >
                <span aria-hidden style={{ width: 16 }}>{l === lang ? '✓' : ''}</span>
                {LANGUAGE_LABEL[l]}
              </button>
            ))}
          </div>
        </>
      )}
      {notice && (
        <div role="alert" className="notif-panel" style={{ padding: '10px 14px', fontSize: 12.5, width: 280 }} data-testid="language-save-failed">
          {t('nav.language.saveFailed', { previous: LANGUAGE_LABEL[notice] })}
        </div>
      )}
    </div>
  );
}
