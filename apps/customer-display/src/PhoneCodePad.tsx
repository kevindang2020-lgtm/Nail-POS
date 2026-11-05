// PhoneCodePad.tsx — BUILD_PLAN Phase 3 (spec: "verification on the customer display").
//
// Staff changed this customer's phone number at the desk and asked them to prove the new number HERE, on the screen
// facing them, instead of reading the code aloud to the receptionist. The display shows only the masked number; the code
// goes straight from the customer's fingers to the server (POST /customer-display/device/phone-code). The receptionist
// never sees it. Success or failure is the server's message, word for word.
import { useState } from 'react';
import { submitPhoneCode, type Creds } from './api';
import { Rich, useT } from './i18n';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'] as const;

export function PhoneCodePad({ creds, maskedPhone, onDone }: { creds: Creds; maskedPhone: string; onDone: () => void }) {
  const t = useT();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const press = (k: (typeof KEYS)[number]) => {
    if (busy || msg?.ok) return;
    setMsg(null);
    if (k === 'clear') setCode('');
    else if (k === 'back') setCode((c) => c.slice(0, -1));
    else setCode((c) => (c.length < 6 ? c + k : c));
  };

  const submit = async () => {
    setBusy(true);
    try {
      const r = await submitPhoneCode(creds, code);
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) setTimeout(onDone, 2500); else setCode('');
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || t('pc.err') });
      setCode('');
    } finally { setBusy(false); }
  };

  return (
    <div data-testid="phone-code-pad" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, background: '#FBF7F0', color: '#2B2118', fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1 style={{ font: '700 30px/1.2 "Playfair Display",serif', margin: 0 }}>{t('pc.title')}</h1>
      <p style={{ fontSize: 18, margin: 0, color: '#6B5D4C', textAlign: 'center' }}><Rich text={t('pc.sub', { phone: maskedPhone })} /></p>
      <div aria-label={t('pc.entered')} data-testid="pad-code" style={{ fontSize: 40, letterSpacing: 14, fontWeight: 700, minHeight: 52 }}>
        {code.padEnd(6, '·')}
      </div>
      {msg ? <div role="alert" data-testid="pad-message" style={{ fontSize: 18, fontWeight: 600, color: msg.ok ? '#2F6B3A' : '#8F3226' }}>{msg.text}</div> : null}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 96px)', gap: 12 }}>
        {KEYS.map((k) => (
          <button key={k} onClick={() => press(k)} disabled={busy} aria-label={k === 'back' ? t('pc.delete') : k === 'clear' ? t('pc.clear') : k}
            style={{ height: 72, fontSize: k.length > 1 ? 16 : 28, fontWeight: 600, borderRadius: 14, border: '1px solid #E7DBC6', background: '#fff', color: '#2B2118', cursor: 'pointer' }}>
            {k === 'back' ? '⌫' : k === 'clear' ? t('pc.clear') : k}
          </button>
        ))}
      </div>
      <button onClick={() => void submit()} disabled={busy || code.length !== 6 || !!msg?.ok}
        style={{ width: 312, height: 64, fontSize: 20, fontWeight: 700, borderRadius: 14, border: 0, background: '#A96F22', color: '#fff', opacity: busy || code.length !== 6 || msg?.ok ? 0.5 : 1, cursor: 'pointer' }}>
        {busy ? t('pc.checking') : t('pc.confirm')}
      </button>
      <button onClick={onDone} disabled={busy} style={{ background: 'none', border: 0, color: '#6B5D4C', fontSize: 15, cursor: 'pointer' }}>{t('pc.notNow')}</button>
    </div>
  );
}
