import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';

// ActivateAccountScreen — first-time Customer App activation: phone → six-digit SMS code → (salon choice) → in.
//
// The customer is asked ONLY for their phone number first. Everything else (which salon, which profile) is
// resolved SERVER-side after they prove they hold the number. Nothing about a customer is shown before the code
// is verified — not even whether the number is known to us.
import logoImage from '../brand/aipoerbadgelogo.png';
const GOLD = 'var(--customer-primary, #A96F22)';
const GOLD_DEEP = '#84561A';
const GOLD_BRONZE = '#C9971B';
const LINE = 'var(--line, #E7DCC9)';
const TEXT = 'var(--text, #2A2118)';
const MUTED = '#8A7A66';
const SERIF = 'Georgia, "Times New Roman", serif';

const card: React.CSSProperties = {
  width: '100%', maxWidth: 420, background: '#FFFDF8', border: `1px solid ${LINE}`, borderRadius: 22,
  boxShadow: '0 20px 60px rgba(42,33,24,.10)', padding: '26px 22px 22px',
};
const label: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 6 };
const input: React.CSSProperties = {
  width: '100%', height: 50, borderRadius: 12, border: `1px solid ${LINE}`, background: '#FFFDF8',
  padding: '0 14px', fontFamily: 'inherit', fontSize: 16, color: TEXT, outline: 'none',   // 16px avoids iOS zoom
};
const primaryBtn = (busy: boolean): React.CSSProperties => ({
  width: '100%', height: 52, borderRadius: 12, border: 'none', marginTop: 4,
  cursor: busy ? 'default' : 'pointer', color: '#FFFDF8', fontSize: 16.5, fontFamily: SERIF,
  background: busy ? '#D6C097' : `linear-gradient(180deg, ${GOLD_BRONZE} 0%, ${GOLD} 55%, ${GOLD_DEEP} 100%)`,
  boxShadow: busy ? 'none' : '0 8px 20px rgba(169,111,34,.28)',
});
const errBox: React.CSSProperties = {
  marginBottom: 12, padding: '10px 12px', borderRadius: 9, fontSize: 13.5,
  background: '#FBEDE9', border: '1px solid #F0D2C9', color: '#8F3226',
};

const COUNTRY_CODES = [
  { code: '+1', country: 'United States & Canada', flag: '🇺🇸', label: '+1 US/CA' },
  { code: '+91', country: 'India', flag: '🇮🇳', label: '+91 India' },
  { code: '+44', country: 'United Kingdom', flag: '🇬🇧', label: '+44 UK' },
  { code: '+61', country: 'Australia', flag: '🇦🇺', label: '+61 Australia' },
  { code: '+84', country: 'Vietnam', flag: '🇻🇳', label: '+84 Vietnam' },
  { code: '+63', country: 'Philippines', flag: '🇵🇭', label: '+63 Philippines' },
  { code: '+971', country: 'United Arab Emirates', flag: '🇦🇪', label: '+971 UAE' },
  { code: '+65', country: 'Singapore', flag: '🇸🇬', label: '+65 Singapore' },
  { code: '+52', country: 'Mexico', flag: '🇲🇽', label: '+52 Mexico' },
  { code: '+49', country: 'Germany', flag: '🇩🇪', label: '+49 Germany' },
  { code: '+33', country: 'France', flag: '🇫🇷', label: '+33 France' },
  { code: '+34', country: 'Spain', flag: '🇪🇸', label: '+34 Spain' },
  { code: '+39', country: 'Italy', flag: '🇮🇹', label: '+39 Italy' },
  { code: '+81', country: 'Japan', flag: '🇯🇵', label: '+81 Japan' },
  { code: '+82', country: 'South Korea', flag: '🇰🇷', label: '+82 S. Korea' },
  { code: '+55', country: 'Brazil', flag: '🇧🇷', label: '+55 Brazil' },
  { code: '+92', country: 'Pakistan', flag: '🇵🇰', label: '+92 Pakistan' },
  { code: '+880', country: 'Bangladesh', flag: '🇧🇩', label: '+880 Bangladesh' },
  { code: '+977', country: 'Nepal', flag: '🇳🇵', label: '+977 Nepal' },
  { code: '+86', country: 'China', flag: '🇨🇳', label: '+86 China' },
  { code: '+64', country: 'New Zealand', flag: '🇳🇿', label: '+64 New Zealand' },
  { code: '+353', country: 'Ireland', flag: '🇮🇪', label: '+353 Ireland' },
  { code: '+27', country: 'South Africa', flag: '🇿🇦', label: '+27 South Africa' },
  { code: '+234', country: 'Nigeria', flag: '🇳🇬', label: '+234 Nigeria' },
  { code: '+254', country: 'Kenya', flag: '🇰🇪', label: '+254 Kenya' },
  { code: '+31', country: 'Netherlands', flag: '🇳🇱', label: '+31 Netherlands' },
  { code: '+46', country: 'Sweden', flag: '🇸🇪', label: '+46 Sweden' },
  { code: '+41', country: 'Switzerland', flag: '🇨🇭', label: '+41 Switzerland' },
  { code: '+48', country: 'Poland', flag: '🇵🇱', label: '+48 Poland' },
  { code: '+90', country: 'Turkey', flag: '🇹🇷', label: '+90 Turkey' },
  { code: '+966', country: 'Saudi Arabia', flag: '🇸🇦', label: '+966 Saudi Arabia' },
  { code: '+974', country: 'Qatar', flag: '🇶🇦', label: '+974 Qatar' },
  { code: '+965', country: 'Kuwait', flag: '🇰🇼', label: '+965 Kuwait' },
  { code: '+972', country: 'Israel', flag: '🇮🇱', label: '+972 Israel' },
  { code: '+60', country: 'Malaysia', flag: '🇲🇾', label: '+60 Malaysia' },
  { code: '+66', country: 'Thailand', flag: '🇹🇭', label: '+66 Thailand' },
  { code: '+62', country: 'Indonesia', flag: '🇮🇩', label: '+62 Indonesia' },
  { code: '+57', country: 'Colombia', flag: '🇨🇴', label: '+57 Colombia' },
  { code: '+54', country: 'Argentina', flag: '🇦🇷', label: '+54 Argentina' },
  { code: '+56', country: 'Chile', flag: '🇨🇱', label: '+56 Chile' },
  { code: '+51', country: 'Peru', flag: '🇵🇪', label: '+51 Peru' },
  { code: '+20', country: 'Egypt', flag: '🇪🇬', label: '+20 Egypt' },
];

function CountryCodePicker({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selected = COUNTRY_CODES.find((c) => c.code === value) || COUNTRY_CODES[0];

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    const timer = setTimeout(() => searchInputRef.current?.focus(), 60);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? COUNTRY_CODES.filter(
        (c) =>
          c.country.toLowerCase().includes(q) ||
          c.code.toLowerCase().includes(q) ||
          c.label.toLowerCase().includes(q)
      )
    : COUNTRY_CODES;

  return (
    <div ref={containerRef} style={{ position: 'relative', width: 104, flexShrink: 0 }}>
      {/* Trigger Button */}
      <button
        type="button"
        id="act-country-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Country code, currently ${selected.country} (${selected.code})`}
        onClick={() => {
          setOpen((prev) => !prev);
          setSearch('');
        }}
        style={{
          width: '100%',
          height: 50,
          borderRadius: 12,
          border: `1px solid ${open ? GOLD : LINE}`,
          boxShadow: open ? '0 0 0 3px rgba(169,111,34,.14)' : 'none',
          background: '#FFFDF8',
          padding: '0 8px 0 10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 13.5,
          fontWeight: 600,
          color: TEXT,
          outline: 'none',
          transition: 'border-color 0.15s, box-shadow 0.15s',
          boxSizing: 'border-box',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: 16 }}>{selected.flag}</span>
          <span>{selected.code}</span>
        </span>
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke={MUTED}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            flexShrink: 0,
            marginLeft: 2,
            transition: 'transform 0.2s ease',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Accessible native select (allows standard accessibility / test inspection) */}
      <select
        id="act-country"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        tabIndex={-1}
        aria-hidden="true"
        style={{
          position: 'absolute',
          opacity: 0,
          pointerEvents: 'none',
          width: 1,
          height: 1,
          top: 0,
          left: 0,
        }}
      >
        {COUNTRY_CODES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.flag} {c.label}
          </option>
        ))}
      </select>

      {/* Popover Dropdown */}
      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 1000,
            width: 'min(310px, calc(100vw - 44px))',
            background: '#FFFDF8',
            border: `1px solid ${LINE}`,
            borderRadius: 14,
            boxShadow: '0 12px 36px rgba(42,33,24,0.18)',
            padding: 8,
            boxSizing: 'border-box',
          }}
        >
          {/* Search bar */}
          <div style={{ position: 'relative', marginBottom: 6 }}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke={MUTED}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search country or code..."
              style={{
                width: '100%',
                height: 38,
                borderRadius: 9,
                border: `1px solid ${LINE}`,
                background: '#FFFFFF',
                padding: '0 28px 0 30px',
                fontFamily: 'inherit',
                fontSize: 13,
                color: TEXT,
                outline: 'none',
                boxSizing: 'border-box',
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = GOLD;
                e.currentTarget.style.boxShadow = '0 0 0 2px rgba(169,111,34,.12)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = LINE;
                e.currentTarget.style.boxShadow = 'none';
              }}
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: MUTED,
                  cursor: 'pointer',
                  fontSize: 12,
                  padding: 2,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                ✕
              </button>
            ) : null}
          </div>

          {/* Scrollable Country List */}
          <div
            style={{
              maxHeight: 220,
              overflowY: 'auto',
              overscrollBehavior: 'contain',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            {filtered.length === 0 ? (
              <div style={{ padding: '16px 12px', textAlign: 'center', color: MUTED, fontSize: 13 }}>
                No country found
              </div>
            ) : (
              filtered.map((c) => {
                const isSelected = c.code === value;
                return (
                  <button
                    key={`${c.code}-${c.country}`}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onChange(c.code);
                      setOpen(false);
                      setSearch('');
                      document.getElementById('act-phone')?.focus();
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 9,
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: 'none',
                      background: isSelected ? 'rgba(169,111,34,0.12)' : 'transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: 'inherit',
                      color: TEXT,
                      transition: 'background-color 0.1s',
                      boxSizing: 'border-box',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) e.currentTarget.style.background = 'rgba(169,111,34,0.06)';
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <span style={{ fontSize: 18, lineHeight: 1 }}>{c.flag}</span>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: isSelected ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.country}
                    </span>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: GOLD, minWidth: 42, textAlign: 'right' }}>
                      {c.code}
                    </span>
                    {isSelected ? (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={GOLD_DEEP} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type Step = 'phone' | 'code' | 'choose' | 'done' | 'new_customer';
interface SalonChoice { choiceId: string; salonName: string }

export function ActivateAccountScreen({ onBack, onFindSalon }: { onBack: () => void; onFindSalon: () => void }) {
  const { setPrincipal } = useAuth();
  const [step, setStep] = useState<Step>('phone');
  const [countryCode, setCountryCode] = useState('+1');
  const [rawPhone, setRawPhone] = useState('');
  const [fullPhone, setFullPhone] = useState('');
  const [masked, setMasked] = useState('');
  const [code, setCode] = useState('');
  const [ticket, setTicket] = useState('');
  const [choices, setChoices] = useState<SalonChoice[]>([]);
  const [salonName, setSalonName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  // Resend countdown.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => { if (step === 'code') codeRef.current?.focus(); }, [step]);

  const handlePhoneInput = (val: string) => {
    setErr(null);
    let trimmed = val.trim();
    // Auto-detect typed or pasted country codes (e.g. +91...)
    if (trimmed.startsWith('+')) {
      const match = COUNTRY_CODES.slice().sort((a, b) => b.code.length - a.code.length).find((c) => trimmed.startsWith(c.code));
      if (match) {
        setCountryCode(match.code);
        trimmed = trimmed.slice(match.code.length);
      }
    }
    setRawPhone(trimmed);
  };

  const computeFullPhone = (): string => {
    const digits = rawPhone.replace(/\D/g, '');
    if (!digits) return '';
    return `${countryCode}${digits}`;
  };

  const fail = (e: any, fallback: string) => {
    const errCode = e?.code || '';
    const msg = e?.message || '';
    if (errCode === 'sms_unavailable' || e?.status === 503) {
      setErr('We could not send a verification code right now. Please verify your phone number and try again in a moment.');
    } else if (errCode === 'invalid_phone') {
      setErr('Please enter a valid mobile phone number eligible to receive SMS verification.');
    } else if (errCode === 'too_many_requests') {
      setErr('Too many attempts. Please wait a few minutes before trying again.');
    } else if (/network|fetch/i.test(msg)) {
      setErr('Unable to connect to AI PowerSalon. Please check your internet connection.');
    } else {
      setErr(msg || fallback);
    }
  };

  const sendCode = async (resend = false) => {
    if (busy) return;
    setErr(null);
    if (!rawPhone.trim()) {
      setErr('Enter your mobile phone number.');
      return;
    }
    const targetPhone = computeFullPhone();
    if (!targetPhone || targetPhone.replace(/\D/g, '').length < 7) {
      setErr('Please enter a valid mobile phone number.');
      return;
    }
    setBusy(true);
    setFullPhone(targetPhone);
    try {
      const r = await api.post<{ ok: boolean; message: string; maskedPhone?: string }>(
        resend ? '/customer/auth/activation/resend-code' : '/customer/auth/activation/request-code',
        { phone: targetPhone },
      );
      setMasked(r.maskedPhone || targetPhone.slice(-4));
      setStep('code');
      setCooldown(60);
      setCode('');
    } catch (e: any) {
      // Cooldown wait
      if (e?.retryAfterSeconds) { setCooldown(e.retryAfterSeconds); setStep('code'); setErr(e.message || null); }
      else fail(e, 'We could not send a verification code right now. Please try again or contact support.');
    } finally { setBusy(false); }
  };

  const enter = (outcome: any) => {
    if (outcome.outcome === 'SUCCESS') { setSalonName(outcome.salonName || ''); setStep('done'); return true; }
    if (outcome.outcome === 'SALON_SELECTION_REQUIRED') { setTicket(outcome.ticket); setChoices(outcome.choices || []); setStep('choose'); return true; }
    if (outcome.outcome === 'NEW_CUSTOMER') { setStep('new_customer'); return true; }
    setErr(outcome.message || 'Unable to verify the code. Please try again.');
    return false;
  };

  const verify = async () => {
    if (busy) return;
    setErr(null);
    if (!/^\d{6}$/.test(code.trim())) { setErr('Enter the six-digit code.'); return; }
    setBusy(true);
    try { enter(await api.post<any>('/customer/auth/activation/verify-code', { phone: fullPhone, code: code.trim() })); }
    catch (e: any) { fail(e, 'Unable to verify the code. Please try again.'); }
    finally { setBusy(false); }
  };

  const pickSalon = async (choiceId: string) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try { enter(await api.post<any>('/customer/auth/activation/select-salon', { ticket, choiceId })); }
    catch (e: any) { fail(e, 'Unable to verify the code. Please try again.'); }
    finally { setBusy(false); }
  };

  // The session cookie is already set by the backend; refresh the principal to enter the app.
  const openApp = async () => {
    try {
      const me = await api.get<any>('/auth/me');
      setPrincipal(me && me.role ? me : null);
    } catch { setPrincipal(null); }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 'max(20px, env(safe-area-inset-top)) 18px max(20px, env(safe-area-inset-bottom))', background: 'var(--page, #F7EFE3)' }}>
      <div style={card}>
        <img src={logoImage} alt="AI PowerSalon" width={240}
          style={{ width: 240, height: 'auto', display: 'block', margin: '0 auto 14px' }} draggable={false} />

        {err ? <div role="alert" style={errBox}>{err}</div> : null}

        {step === 'phone' && (
          <form onSubmit={(e) => { e.preventDefault(); sendCode(false); }} noValidate>
            <h1 style={{ fontFamily: SERIF, fontSize: 25, color: TEXT, textAlign: 'center', margin: '0 0 6px' }}>Create Your Account</h1>
            <p style={{ textAlign: 'center', color: MUTED, fontSize: 14, margin: '0 0 20px', lineHeight: 1.45 }}>
              Enter the phone number connected to your salon profile to receive a verification code.
            </p>

            <div style={{ marginBottom: 18 }}>
              <label htmlFor="act-phone" style={label}>Mobile Phone Number</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                <CountryCodePicker value={countryCode} onChange={setCountryCode} />
                <input
                  id="act-phone"
                  style={{ ...input, flex: 1 }}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="Phone number"
                  value={rawPhone}
                  onChange={(e) => handlePhoneInput(e.target.value)}
                />
              </div>
              <div style={{ fontSize: 12, color: MUTED, marginTop: 10, paddingLeft: 2 }}>
                Sending code to: <strong style={{ color: TEXT }}>{computeFullPhone() || `${countryCode} (enter digits)`}</strong>
              </div>
            </div>

            <button type="submit" disabled={busy} style={primaryBtn(busy)}>
              {busy ? 'Sending code…' : 'Send Verification Code'}
            </button>
            <button type="button" onClick={onBack}
              style={{ width: '100%', marginTop: 14, background: 'none', border: 0, color: GOLD, fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
              Back to sign in
            </button>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={(e) => { e.preventDefault(); verify(); }} noValidate>
            <h1 style={{ fontFamily: SERIF, fontSize: 25, color: TEXT, textAlign: 'center', margin: '0 0 6px' }}>Verify Your Phone</h1>
            <p style={{ textAlign: 'center', color: MUTED, fontSize: 14, margin: '0 0 20px', lineHeight: 1.45 }}>
              Enter the six-digit code sent to the phone number ending in {masked || '••••'}.
            </p>

            <label htmlFor="act-code" style={label}>Verification Code</label>
            <input id="act-code" ref={codeRef} style={{ ...input, letterSpacing: '.42em', textAlign: 'center', fontSize: 22 }}
              type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
              placeholder="••••••" value={code}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 6);   // paste + SMS autofill land here
                setCode(v);
              }} />

            <button type="submit" disabled={busy} style={{ ...primaryBtn(busy), marginTop: 16 }}>
              {busy ? 'Verifying…' : 'Verify and Continue'}
            </button>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
              <button type="button" disabled={cooldown > 0 || busy} onClick={() => sendCode(true)}
                style={{ background: 'none', border: 0, color: cooldown > 0 ? MUTED : GOLD, fontSize: 13.5, fontWeight: 500, cursor: cooldown > 0 ? 'default' : 'pointer', padding: 0 }}>
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
              </button>
              <button type="button" onClick={() => { setStep('phone'); setErr(null); setCode(''); }}
                style={{ background: 'none', border: 0, color: GOLD, fontSize: 13.5, fontWeight: 500, cursor: 'pointer', padding: 0 }}>
                Change phone number
              </button>
            </div>
          </form>
        )}

        {step === 'choose' && (
          <div>
            <h1 style={{ fontFamily: SERIF, fontSize: 24, color: TEXT, textAlign: 'center', margin: '0 0 6px' }}>Choose Your Salon</h1>
            <p style={{ textAlign: 'center', color: MUTED, fontSize: 14, margin: '0 0 18px', lineHeight: 1.45 }}>
              This number is connected to more than one salon. Which would you like to open?
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {choices.map((c) => (
                <button key={c.choiceId} type="button" disabled={busy} onClick={() => pickSalon(c.choiceId)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 14px', borderRadius: 12, border: `1px solid ${LINE}`, background: '#fff', font: 'inherit', color: TEXT, cursor: 'pointer', minHeight: 52 }}>
                  <span style={{ fontSize: 15 }}>{c.salonName}</span>
                  <span style={{ color: GOLD, fontSize: 13, fontWeight: 600 }}>Open</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 'new_customer' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 58, height: 58, borderRadius: '50%', margin: '4px auto 14px', display: 'grid', placeItems: 'center', background: '#EAF1E7', border: '1px solid #CFE0C9' }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#3F6B46" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 12.5l5 5L20 6.5" /></svg>
            </div>
            <h1 style={{ fontFamily: SERIF, fontSize: 25, color: TEXT, margin: '0 0 6px' }}>Phone Verified</h1>
            <p style={{ color: MUTED, fontSize: 14, margin: '0 0 6px', lineHeight: 1.45 }}>
              We don&rsquo;t have a salon profile linked to this number yet.
            </p>
            <p style={{ color: MUTED, fontSize: 13, margin: '0 0 18px', lineHeight: 1.45 }}>
              Choose your salon to finish setting up your account.
            </p>
            <button type="button" onClick={onFindSalon} style={primaryBtn(false)}>Find Your Salon</button>
            <button type="button" onClick={onBack}
              style={{ width: '100%', marginTop: 12, background: 'none', border: 0, color: GOLD, fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
              Back to sign in
            </button>
          </div>
        )}

        {step === 'done' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 58, height: 58, borderRadius: '50%', margin: '4px auto 14px', display: 'grid', placeItems: 'center', background: '#EAF1E7', border: '1px solid #CFE0C9' }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#3F6B46" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 12.5l5 5L20 6.5" /></svg>
            </div>
            <h1 style={{ fontFamily: SERIF, fontSize: 25, color: TEXT, margin: '0 0 6px' }}>Phone Verified</h1>
            <p style={{ color: MUTED, fontSize: 14, margin: '0 0 8px' }}>Your AI PowerSalon account is ready.</p>
            {salonName ? <p style={{ color: MUTED, fontSize: 13, margin: '0 0 16px' }}>{salonName}</p> : null}
            <p style={{ color: MUTED, fontSize: 12.5, margin: '0 0 18px' }}>
              You can create a password later under Profile → Security to make future sign-ins easier.
            </p>
            <button type="button" onClick={openApp} style={primaryBtn(false)}>Continue</button>
          </div>
        )}
      </div>
    </div>
  );
}
