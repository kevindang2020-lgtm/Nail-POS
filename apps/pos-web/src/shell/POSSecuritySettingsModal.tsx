import { useEffect, useState } from 'react';
import type { SessionLockStatus } from '@aipowersalon/api-contracts';
import { api } from '../api/client';
import { writeIdleLockSettings, effectiveIdleLock, readSalonLock, writeSalonLock, IDLE_LOCK_MINUTE_CHOICES, LONG_INACTIVITY_HOURS } from './idle-lock';
import { t } from '@aipowersalon/mobile-sdk/i18n';

// Kevin, Oct 12 2026: the salon's auto-lock (on, 60 minutes by default; owners change it under Security → Sign-in policy) is
// enforced by the server on every POS. This device may lock SOONER (Decision 35), never later, and cannot switch the salon's
// lock off — the choices stop at the salon's value and the switch is fixed on while the salon's lock is on.
export function POSSecuritySettingsModal({ onClose }: { onClose: () => void }) {
  const [salon, setSalon] = useState(() => readSalonLock(localStorage));
  const [lockSettings, setLockSettings] = useState(() => effectiveIdleLock(localStorage));
  const autoLockEnabled = lockSettings.enabled;
  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(() => api.get<SessionLockStatus>('/auth/lock-status')).then((st) => {
      if (!alive || !st?.salon) return;
      writeSalonLock(localStorage, st.salon); setSalon(st.salon); setLockSettings(effectiveIdleLock(localStorage));
    }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  const choices = IDLE_LOCK_MINUTE_CHOICES.filter((m) => !salon.enabled || m <= salon.minutes);

  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  // Step-up (merge Oct 12, AUTH): /auth/set-pin re-authenticates — the current password, or the current PIN once one is
  // set. A wrong / missing one is 403 STEP_UP_REQUIRED; 5 failures in 10 minutes → 429. Never a default PIN.
  const [stepUpWith, setStepUpWith] = useState<'password' | 'pin'>('password');
  const [current, setCurrent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Decision 35: stored as 'true'/'false' so "turned off on this device" is remembered (unset = on, 60 minutes).
  const toggleAutoLock = (val: boolean) => { writeIdleLockSettings(localStorage, { enabled: val }); setLockSettings(effectiveIdleLock(localStorage)); };
  const setLockMinutes = (minutes: number) => { writeIdleLockSettings(localStorage, { minutes, enabled: true }); setLockSettings(effectiveIdleLock(localStorage)); };

  const savePin = async () => {
    setError(null);
    setSuccess(null);
    if (pin.length !== 4) {
      setError(t('pos.pin_must_be_exactly_4_digits'));
      return;
    }
    if (pin !== confirmPin) {
      setError(t('pos.pins_do_not_match'));
      return;
    }
    if (!current) {
      setError(stepUpWith === 'password' ? t('pos.enter_your_current_password_to_change_1yik') : t('pos.enter_your_current_pin_to_change_5dkk'));
      return;
    }
    setLoading(true);
    try {
      const { success } = await api.post<{ success: boolean }>('/auth/set-pin', { pin, ...(stepUpWith === 'password' ? { currentPassword: current } : { currentPin: current }) });
      if (success) {
        setSuccess(t('admin.security.pinUpdated'));
        setPin('');
        setConfirmPin('');
        setCurrent('');
      } else {
        setError(t('pos.failed_to_update_pin'));
      }
    } catch (e: any) {
      setCurrent('');
      setError(e?.code === 'STEP_UP_REQUIRED' ? (stepUpWith === 'password' ? t('pos.current_password_is_incorrect') : t('pos.current_pin_is_incorrect'))
        : e?.status === 429 ? t('pos.too_many_attempts_try_again_in_10vb')
        : e?.code === 'invalid_pin' ? (e?.message || t('pos.pin_must_be_4_8_digits'))
        : t('pos.error_connecting_to_server_to_update_bc9x'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'fadeIn 0.2s ease-out' }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .sec-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
        .sec-btn:active:not(:disabled) { transform: translateY(1px); box-shadow: 0 2px 6px rgba(0,0,0,0.1); }
      `}</style>
      <div style={{ background: '#FFF', width: 420, maxWidth: '90vw', borderRadius: 20, overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
        
        {/* Header */}
        <div style={{ padding: '24px', borderBottom: '1px solid #F3F4F6', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#FAFAFA' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, color: '#111827', fontWeight: 600 }}>{t('pos.security_settings')}</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6B7280' }}>{t('pos.manage_device_lock_and_quick_access_nyre')}</p>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: '#F3F4F6', width: 32, height: 32, borderRadius: 16, cursor: 'pointer', color: '#4B5563', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.2s' }} onMouseOver={e => e.currentTarget.style.background = '#E5E7EB'} onMouseOut={e => e.currentTarget.style.background = '#F3F4F6'}>
            <span style={{ fontSize: 20, lineHeight: 1 }}>&times;</span>
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '24px' }}>
          
          {/* Auto Lock Toggle */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#1F2937' }}>{t('pos.auto_lock_pos_screen')}</div>
              <div style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>{t('pos.lock_this_device_after')}
                <select aria-label={t('pos.auto_lock_after')} value={lockSettings.minutes} disabled={!autoLockEnabled} onChange={(e) => setLockMinutes(Number(e.target.value))} style={{ margin: '0 6px', fontSize: 13 }}>
                  {choices.map((m) => <option key={m} value={m}>{m} {m === 1 ? 'minute' : 'minutes'}</option>)}
                </select>
                {t('pos.of_inactivity_unlock_with_your_pin_f0v5')}{' '}{LONG_INACTIVITY_HOURS} {t('pos.hours_locked_a_full_sign_in_owp6')}</div>
              <div style={{ fontSize: 12, color: '#6B7280', marginTop: 6 }}>
                {salon.enabled
                  ? <>{t('pos.your_salon_locks_every_pos_after')}{' '}{salon.minutes} {t('pos.minutes_without_use_enforced_by_the_15rn')}</>
                  : <>{t('pos.your_salon_has_switched_the_automatic_25bm')}</>}
              </div>
            </div>
            <label style={{ display: 'flex', cursor: salon.enabled ? 'not-allowed' : 'pointer', position: 'relative' }}>
              <input type="checkbox" aria-label={t('pos.auto_lock_on_this_device')} checked={autoLockEnabled} disabled={salon.enabled} onChange={(e) => toggleAutoLock(e.target.checked)} style={{ width: 44, height: 24, borderRadius: 12, appearance: 'none', background: autoLockEnabled ? '#10B981' : '#E5E7EB', outline: 'none', cursor: salon.enabled ? 'not-allowed' : 'pointer', transition: 'background 0.3s' }} />
              <div style={{ position: 'absolute', top: 2, left: autoLockEnabled ? 22 : 2, width: 20, height: 20, borderRadius: 10, background: '#FFF', transition: 'left 0.3s', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }} />
            </label>
          </div>

          <div style={{ borderTop: '1px solid #F3F4F6', margin: '0 -24px 24px' }} />

          {/* PIN Setup */}
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#1F2937', marginBottom: 6 }}>{t('pos.setup_or_change_pin')}</div>
            <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 20 }}>{t('pos.enter_a_4_digit_pin_to_1dcz')}</div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
              <div>
                <div role="radiogroup" aria-label={t('pos.confirm_it_is_you_with')} style={{ display: 'flex', gap: 14, fontSize: 13, color: '#374151', marginBottom: 6 }}>
                  <label style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}><input type="radio" name="stepup" checked={stepUpWith === 'password'} onChange={() => { setStepUpWith('password'); setCurrent(''); }} /> {t('pos.current_password')}</label>
                  <label style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}><input type="radio" name="stepup" checked={stepUpWith === 'pin'} onChange={() => { setStepUpWith('pin'); setCurrent(''); }} /> {t('pos.current_pin')}</label>
                </div>
                <input
                  type="password"
                  aria-label={stepUpWith === 'password' ? t('pos.current_password') : t('pos.current_pin')}
                  autoComplete={stepUpWith === 'password' ? 'current-password' : 'off'}
                  inputMode={stepUpWith === 'pin' ? 'numeric' : undefined}
                  value={current}
                  onChange={(e) => setCurrent(stepUpWith === 'pin' ? e.target.value.replace(/\D/g, '').slice(0, 8) : e.target.value)}
                  placeholder={stepUpWith === 'password' ? t('pos.required_to_change_your_pin') : t('pos.your_current_pin')}
                  style={{ width: '100%', height: 44, border: '1px solid #D1D5DB', borderRadius: 8, padding: '0 16px', fontSize: 15, background: '#FAFAFA', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>{t('pos.new_pin')}</label>
                <input 
                  type="password" 
                  maxLength={4}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="• • • •"
                  style={{ width: '100%', height: 44, border: '1px solid #D1D5DB', borderRadius: 8, padding: '0 16px', fontSize: 24, letterSpacing: '8px', background: '#FAFAFA', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>{t('pos.confirm_new_pin')}</label>
                <input 
                  type="password" 
                  maxLength={4}
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="• • • •"
                  style={{ width: '100%', height: 44, border: '1px solid #D1D5DB', borderRadius: 8, padding: '0 16px', fontSize: 24, letterSpacing: '8px', background: '#FAFAFA', boxSizing: 'border-box' }}
                />
              </div>
            </div>

            {error && <div style={{ color: '#EF4444', fontSize: 13, marginBottom: 16, background: '#FEE2E2', padding: '8px 12px', borderRadius: 6, fontWeight: 500 }}>{error}</div>}
            {success && <div style={{ color: '#10B981', fontSize: 13, marginBottom: 16, background: '#D1FAE5', padding: '8px 12px', borderRadius: 6, fontWeight: 500 }}>{success}</div>}

            <button 
              className="sec-btn"
              onClick={savePin}
              disabled={loading || pin.length !== 4 || confirmPin.length !== 4 || !current}
              style={{ width: '100%', height: 44, background: '#111827', color: '#FFF', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: (loading || pin.length !== 4) ? 'not-allowed' : 'pointer', opacity: (loading || pin.length !== 4) ? 0.6 : 1, transition: 'all 0.2s' }}
            >
              {loading ? t('pos.saving_3') : t('pos.save_pin')}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
