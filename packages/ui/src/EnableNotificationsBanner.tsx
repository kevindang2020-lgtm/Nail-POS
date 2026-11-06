// EnableNotificationsBanner.tsx — "Turn on notifications", asked from a TAP (Nov 6 2026, Kevin).
//
// The apps used to ask for notification permission the moment someone signed in. Browsers block or quietly suppress a
// permission prompt that is not started by the person's own click (Safari refuses it outright), and a prompt with no
// context is the one people deny — after which the app can never ask again. Now nothing asks at sign-in: this banner
// explains why and asks only when "Turn on" is tapped. "Not now" hides it on this device for 30 days.
//
// Presentational only: each app's push client supplies whether to show it and what "Turn on" does
// (@aipowersalon/mobile-sdk usePushPrompt for the store apps, @aipowersalon/web-push usePushPrompt for POS / admin).
import { useState } from 'react';

export const PUSH_PROMPT_DISMISS_KEY = 'aps_push_prompt_dismissed_at';
export const PUSH_PROMPT_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

/** Did the person tap "Not now" on this device in the last 30 days? */
export function pushPromptSnoozed(now = Date.now()): boolean {
  try { const at = Number(localStorage.getItem(PUSH_PROMPT_DISMISS_KEY) || 0); return at > 0 && now - at < PUSH_PROMPT_SNOOZE_MS; } catch { return false; }
}
export function snoozePushPrompt(now = Date.now()): void {
  try { localStorage.setItem(PUSH_PROMPT_DISMISS_KEY, String(now)); } catch { /* private mode: it simply shows again */ }
}

export interface EnableNotificationsBannerProps {
  visible: boolean;
  /** Runs inside the tap, so the browser / OS shows its permission prompt. Resolves true when allowed. */
  onEnable: () => Promise<boolean>;
  onDismiss: () => void;
  /** One line on what the notifications are for in this app. */
  reason?: string;
  accent?: string;
  style?: React.CSSProperties;
}

export function EnableNotificationsBanner({ visible, onEnable, onDismiss, reason, accent = '#A96F22', style }: EnableNotificationsBannerProps) {
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  if (!visible) return null;
  const enable = async () => {
    setBusy(true);
    try { const ok = await onEnable(); if (!ok) setBlocked(true); } catch { setBlocked(true); } finally { setBusy(false); }
  };
  return (
    <div role="region" aria-label="Notifications" style={{ display: 'flex', flexShrink: 0, alignItems: 'center', gap: 12, padding: '10px 14px', margin: '8px 12px', borderRadius: 12, background: '#FFF8EC', border: `1px solid ${accent}55`, color: '#2C2118', fontSize: 13.5, lineHeight: 1.35, ...style }}>
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>Turn on notifications</div>
        <div style={{ opacity: 0.8 }}>
          {blocked ? 'Notifications are blocked. You can allow them in your device or browser settings.' : (reason ?? 'Get alerts for new bookings, payments and messages.')}
        </div>
      </div>
      {blocked ? (
        <button type="button" onClick={onDismiss} style={{ background: 'none', border: 0, color: accent, fontWeight: 600, cursor: 'pointer', padding: '6px 8px' }}>OK</button>
      ) : (
        <>
          <button type="button" onClick={onDismiss} disabled={busy} style={{ background: 'none', border: 0, color: '#6D5F50', cursor: 'pointer', padding: '6px 8px', font: 'inherit' }}>Not now</button>
          <button type="button" onClick={enable} disabled={busy} style={{ background: accent, color: '#fff', border: 0, borderRadius: 9, fontWeight: 600, padding: '8px 12px', cursor: busy ? 'default' : 'pointer', font: 'inherit' }}>{busy ? '…' : 'Turn on'}</button>
        </>
      )}
    </div>
  );
}
