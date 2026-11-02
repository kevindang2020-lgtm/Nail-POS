// DeviceScreens.tsx — the customer display's DEVICE screens (23-inch spec §8–§12, §85, §122–§125):
//   Pairing      the display has no credential: it shows a code for the owner to type into the POS
//   Maintenance  the owner switched it to maintenance: a calm screen — no check-in, no advertising, no customer data
//   FullscreenButton  a browser display (the POS's second monitor) has no browser chrome once full screen; one tap does it,
//                and the first touch after a reload restores it (browsers allow full screen only from a touch or click)
import { useEffect, useState } from 'react';
import type { CustomerDisplayState } from '@aipowersalon/api-contracts/customer';
import { formatPairingCode } from '@aipowersalon/api-contracts';   // runtime values: the contracts' root entry
import { isNativePlatform } from '@aipowersalon/mobile-sdk';
import { SalonBrand } from './Branding';
import { usePairing } from './usePairing';
import { useT } from './i18n';

function remaining(expiresAt: string | null, now: number): string | null {
  if (!expiresAt) return null;
  const s = Math.max(0, Math.round((Date.parse(expiresAt) - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function Pairing({ onPaired }: { onPaired: (deviceToken: string) => void }) {
  const p = usePairing(onPaired);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const left = remaining(p.expiresAt, now);
  return (
    <div className="pair-screen" data-testid="pairing">
      <main className="pair-card">
        <div className="pair-kicker">AIPowerSalon Customer Display</div>
        {p.pairedTo ? (
          <div className="pair-done" role="status">
            <div className="kiosk-glyph ok">✓</div>
            <div className="pair-title serif">Paired with {p.pairedTo.salonName}</div>
            <div className="pair-sub">{p.pairedTo.branchName ? `${p.pairedTo.branchName} · ` : ''}{p.pairedTo.deviceName}</div>
          </div>
        ) : (
          <>
            <div className="pair-title serif">Pair this display</div>
            <ol className="pair-steps">
              <li>On the salon’s POS, open <b>Devices → Customer Displays</b>.</li>
              <li>Choose <b>Pair a display</b> and enter this code:</li>
            </ol>
            {p.code ? (
              <div className="pair-code" data-testid="pairing-code" aria-label={`Pairing code ${p.code.split('').join(' ')}`}>{formatPairingCode(p.code)}</div>
            ) : (
              <div className="pair-wait"><div className="kiosk-spinner" /></div>
            )}
            {p.code && left ? <div className="pair-expiry">A new code appears in {left}</div> : null}
            {p.problem ? <div className="pair-problem" role="alert">{p.problem}</div> : null}
            <div className="pair-note">No salon login is entered on this screen. The code works once, only from the salon’s own POS.</div>
          </>
        )}
      </main>
    </div>
  );
}

export function Maintenance({ s }: { s: CustomerDisplayState }) {
  const t = useT();
  return (
    <div className="kiosk-app" data-testid="maintenance">
      <header className="kiosk-brand"><SalonBrand branding={s.branding} salonName={s.salonName} /></header>
      <main className="kiosk-main kiosk-center">
        <div className="kiosk-status">
          <div className="kiosk-glyph muted">⚙</div>
          <div className="kiosk-h serif">{t('app.maintenance.h')}</div>
          <div className="kiosk-sub">{t('app.maintenance.s')}</div>
        </div>
      </main>
    </div>
  );
}

const WANT_FULLSCREEN = 'aps.customerDisplay.fullscreen';
const fsEnabled = (): boolean => typeof document !== 'undefined' && !!document.fullscreenEnabled && !isNativePlatform();
const isFull = (): boolean => typeof document !== 'undefined' && !!document.fullscreenElement;
const wants = (): boolean => { try { return localStorage.getItem(WANT_FULLSCREEN) === '1'; } catch { return false; } };

/** §122, §125: shown only in a browser that is not already full screen. */
export function FullscreenButton() {
  const [full, setFull] = useState(isFull);
  useEffect(() => {
    if (!fsEnabled()) return;
    const onChange = () => setFull(isFull());
    // §125 "restore full-screen state": after a reload the first touch anywhere goes back to full screen
    const restore = () => { if (wants() && !isFull()) void document.documentElement.requestFullscreen?.().catch(() => undefined); };
    document.addEventListener('fullscreenchange', onChange);
    window.addEventListener('pointerdown', restore, { capture: true });
    return () => { document.removeEventListener('fullscreenchange', onChange); window.removeEventListener('pointerdown', restore, { capture: true }); };
  }, []);
  if (!fsEnabled() || full) return null;
  const go = () => {
    try { localStorage.setItem(WANT_FULLSCREEN, '1'); } catch { /* memory of it only */ }
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };
  return <button type="button" className="fs-btn" data-testid="fullscreen-button" onClick={go}>⛶ Full screen</button>;
}
