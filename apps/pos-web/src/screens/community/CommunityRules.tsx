// CommunityRules.tsx — the Safety Community rules acknowledgment (contract §2.3 / §5). Shown before a user's FIRST
// draft or comment and again whenever the rules version changes (the server answers `rulesAcknowledgedByMe` for the
// CURRENT `rulesVersion` in GET /community/settings and refuses a draft / comment with 403 rules_not_acknowledged).
//
// `useCommunityRules()` gives a screen: `ensure(fn)` — runs fn now when the rules are accepted, otherwise opens the
// modal and runs fn right after the user accepts; `require()` — opens the modal without a follow-up (a 403 from the
// server); `modal` — render it once.
import { useCallback, useEffect, useRef, useState } from 'react';
import { COMMUNITY_RULES, COMMUNITY_RULES_VERSION, type CommunitySettingsView } from '@aipowersalon/api-contracts/tenant';
import { posCommunityApi as api } from '../../api/posCommunityApi';
import { btnGhost, btnGold, communityErrorText, errText } from './communityUi';
import { t } from '@aipowersalon/mobile-sdk/i18n';

export function CommunityRulesModal({ version, onAccept, onCancel, busy, error }: { version: string; onAccept: () => void; onCancel: () => void; busy: boolean; error: string | null }) {
  const accept = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { accept.current?.focus(); }, []);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(43,33,24,.45)', zIndex: 250, display: 'grid', placeItems: 'center', padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-labelledby="community-rules-title" data-testid="community-rules"
        onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
        style={{ background: '#FFFCF6', borderRadius: 14, border: '1px solid #D8A646', maxWidth: 620, width: '100%', padding: 20, boxShadow: '0 14px 34px rgba(43,33,24,.25)', maxHeight: '90vh', overflow: 'auto' }}>
        <h2 id="community-rules-title" style={{ margin: '0 0 6px', fontFamily: 'var(--aps-font-head, Playfair Display)', fontSize: 18 }}>{t('pos.safety_community_rules')}</h2>
        <div style={{ color: '#8A857E', fontSize: 12 }}>{t('pos.version')}{' '}{version}{t('pos.please_read_these_before_you_post_1jn2')}</div>
        <ol style={{ margin: '12px 0', paddingLeft: 20, display: 'grid', gap: 8, fontSize: 13, color: '#2C2A27' }}>
          {COMMUNITY_RULES.map((r) => <li key={r}>{r}</li>)}
        </ol>
        {error ? <div role="alert" style={errText}>{error}</div> : null}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
          <button type="button" style={btnGhost} onClick={onCancel}>{t('pos.not_now')}</button>
          <button ref={accept} type="button" style={btnGold} disabled={busy} onClick={onAccept}>{t('pos.i_agree_to_the_community_rules')}</button>
        </div>
      </div>
    </div>
  );
}

export function useCommunityRules(enabled = true) {
  const [settings, setSettings] = useState<CommunitySettingsView | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const after = useRef<(() => void) | null>(null);
  const reload = useCallback(() => {
    if (!enabled) return Promise.resolve(null);
    return api.settings().then((s) => { setSettings(s); return s; }).catch(() => null);
  }, [enabled]);
  useEffect(() => { reload(); }, [reload]);

  const version = settings?.rulesVersion || COMMUNITY_RULES_VERSION;
  const acknowledged = !!settings?.rulesAcknowledgedByMe;
  const ensure = useCallback((fn: () => void) => {
    if (acknowledged) { fn(); return; }
    after.current = fn; setError(null); setOpen(true);
  }, [acknowledged]);
  const requireAck = useCallback(() => { after.current = null; setError(null); setOpen(true); }, []);
  const accept = async () => {
    setBusy(true); setError(null);
    try {
      await api.acknowledgeRules(version);
      setSettings((s) => (s ? { ...s, rulesAcknowledgedByMe: true } : s));
      setOpen(false);
      const fn = after.current; after.current = null; fn?.();
    } catch (e) { setError(communityErrorText(e, t('growth.community.couldNotRecordYourAgreement'))); }
    finally { setBusy(false); }
  };
  const modal = open ? <CommunityRulesModal version={version} busy={busy} error={error} onAccept={accept} onCancel={() => { after.current = null; setOpen(false); }} /> : null;
  return { settings, acknowledged, loaded: settings !== null, ensure, require: requireAck, modal, reload, open };
}
