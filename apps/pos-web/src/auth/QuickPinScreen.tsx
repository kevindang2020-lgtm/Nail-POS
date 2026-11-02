import { useState } from 'react';
import { api } from '../api/client';
import { useAuth } from './AuthContext';
import { t } from '@aipowersalon/mobile-sdk/i18n';

export function QuickPinScreen({ onUnlock, onFullLogout }: { onUnlock: () => void; onFullLogout: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { principal } = useAuth();

  const handleDigit = (d: string) => {
    if (pin.length < 4) {
      const newPin = pin + d;
      setPin(newPin);
      if (newPin.length === 4) {
        verifyPin(newPin);
      }
    }
  };

  const handleClear = () => setPin('');

  const verifyPin = async (attempt: string) => {
    setLoading(true);
    setError(null);
    try {
      const { success } = await api.post<{ success: boolean }>('/auth/verify-pin', { pin: attempt });
      if (success) {
        onUnlock();
      } else {
        setError(t('pos.incorrect_pin'));
        setPin('');
      }
    } catch (e: any) {
      // Sep 2026: an unset PIN or too many wrong guesses means a full sign-in (the server says which)
      const code = e?.code || e?.body?.code || e?.data?.code;
      const status = e?.status;
      if (code === 'pin_not_set' || code === 'pin_login_disabled' || code === 'too_many_attempts' || status === 429) {   // pin_login_disabled: the salon turned PIN unlock off (Constitution 3 Step 9)
        setError(e?.message || t('pos.please_sign_in_with_your_password'));
        setPin('');
        setTimeout(() => onFullLogout(), 1200);
        return;
      }
      setError(status === 403 ? t('pos.incorrect_pin') : t('pos.error_verifying_pin'));
      setPin('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(20, 20, 20, 0.6)', backdropFilter: 'blur(16px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', animation: 'fadeIn 0.3s ease-out' }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        @keyframes shake { 0%, 100% { transform: translateX(0); } 20%, 60% { transform: translateX(-5px); } 40%, 80% { transform: translateX(5px); } }
        .pin-btn { width: 72px; height: 72px; border-radius: 36px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05); color: #FFF; font-size: 28px; font-weight: 300; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; backdrop-filter: blur(10px); }
        .pin-btn:hover { background: rgba(255,255,255,0.15); transform: scale(1.05); }
        .pin-btn:active { background: rgba(255,255,255,0.2); transform: scale(0.95); }
        .pin-dot { width: 14px; height: 14px; border-radius: 7px; background: rgba(255,255,255,0.2); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
        .pin-dot.filled { background: #D4AF37; box-shadow: 0 0 10px rgba(212, 175, 55, 0.5); transform: scale(1.2); }
      `}</style>
      
      <div style={{ padding: 40, textAlign: 'center', width: 360 }}>
        <div style={{ width: 64, height: 64, borderRadius: 32, background: 'linear-gradient(135deg, #D4AF37 0%, #AA8C2C 100%)', margin: '0 auto 20px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFF', fontSize: 24, fontWeight: 'bold', boxShadow: '0 8px 16px rgba(212,175,55,0.3)' }}>
          {principal?.fullName?.charAt(0)?.toUpperCase() || 'U'}
        </div>
        
        <h2 style={{ margin: '0 0 8px', fontSize: 28, color: '#FFF', fontWeight: 500, letterSpacing: '-0.5px' }}>{t('pos.welcome_back')}</h2>
        <p style={{ margin: '0 0 32px', color: 'rgba(255,255,255,0.6)', fontSize: 15 }}>{principal?.fullName || t('pos.enter_pin_to_unlock')}</p>
        
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginBottom: 40, animation: error ? 'shake 0.4s ease-in-out' : 'none' }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={`pin-dot ${i < pin.length ? 'filled' : ''}`} />
          ))}
        </div>

        {error && <div style={{ color: '#FF6B6B', fontSize: 14, marginBottom: 20, marginTop: -20 }}>{error}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, placeItems: 'center', marginBottom: 32 }}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} type="button" className="pin-btn" onClick={() => handleDigit(d)} disabled={loading}>{d}</button>
          ))}
          <button type="button" className="pin-btn" onClick={handleClear} style={{ fontSize: 16, fontWeight: 500 }} disabled={loading}>CLR</button>
          <button type="button" className="pin-btn" onClick={() => handleDigit('0')} disabled={loading}>0</button>
          <button type="button" className="pin-btn" onClick={() => { setPin(pin.slice(0, -1)); setError(null); }} disabled={loading}>
             <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"></path><line x1="18" y1="9" x2="12" y2="15"></line><line x1="12" y1="9" x2="18" y2="15"></line></svg>
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
          <button 
            type="button"
            onClick={onFullLogout}
            style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 14, textDecoration: 'underline' }}
          >
            {t('pos.forgot_pin_log_in_with_password')}
          </button>
        </div>
      </div>
    </div>
  );
}
