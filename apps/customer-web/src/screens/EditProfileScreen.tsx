import { useEffect, useState } from 'react';
import { ChangePhoneScreen } from './ChangePhoneScreen';
import { useNavigate } from 'react-router-dom';
import { customerApi } from '../api/customerApi';
import { FiUser, FiCalendar, FiPhone, FiMail, FiCheckCircle } from 'react-icons/fi';

const fieldStyle: React.CSSProperties = {
  height: 46,
  border: '1px solid var(--customer-border, #E9DAC4)',
  borderRadius: 12,
  padding: '0 14px',
  background: 'var(--customer-card, #FFFFFF)',
  font: 'inherit',
  width: '100%',
  marginTop: 6,
  fontSize: 14,
  color: 'var(--customer-text, #2C2118)',
  boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.02)',
};

export function EditProfileScreen() {
  const nav = useNavigate();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [birthday, setBirthday] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [sms, setSms] = useState(false);
  const [emailOpt, setEmailOpt] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [changingPhone, setChangingPhone] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [code, setCode] = useState('');
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyErr, setVerifyErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    customerApi
      .getProfile()
      .then((p) => {
        if (live && p) {
          setFirstName(p.firstName || '');
          setLastName(p.lastName || '');
          setBirthday(p.birthday || '');
          setPhone(p.phone || '');
          setEmail(p.email || '');
          setSms(!!p.smsOptIn);
          setEmailOpt(!!p.emailOptIn);
          setMarketing(!!p.marketingOptIn);
          setPhoneVerified(!!p.phoneVerified);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const sendCode = async () => {
    setVerifyErr(null);
    setVerifyBusy(true);
    try {
      const r = await customerApi.requestPhoneCode();
      if (r.ok) {
        if (r.verified) setPhoneVerified(true);
        else setVerifyOpen(true);
      } else setVerifyErr(r.message || 'Could not send a code.');
    } catch (e: any) {
      setVerifyErr(e?.message || 'Could not send a code.');
    } finally {
      setVerifyBusy(false);
    }
  };

  const confirmCode = async () => {
    setVerifyErr(null);
    setVerifyBusy(true);
    try {
      const r = await customerApi.confirmPhoneCode(code.trim());
      if (r.ok && r.verified) {
        setPhoneVerified(true);
        setVerifyOpen(false);
      } else setVerifyErr(r.message || 'That code is incorrect.');
    } catch (e: any) {
      setVerifyErr(e?.message || 'Could not verify your number.');
    } finally {
      setVerifyBusy(false);
    }
  };

  const save = async () => {
    setError(null);
    setOk(false);
    setBusy(true);
    const body: Record<string, unknown> = {
      smsOptIn: sms,
      emailOptIn: emailOpt,
      marketingOptIn: marketing,
    };
    if (firstName.trim() && lastName.trim()) {
      body.firstName = firstName.trim();
      body.lastName = lastName.trim();
    }
    body.birthday = birthday.trim();
    if (email.trim()) body.email = email.trim();
    try {
      await customerApi.updateProfile(body);
      setOk(true);
    } catch (e: any) {
      setError(e?.message || 'Update failed.');
    } finally {
      setBusy(false);
    }
  };

  const Toggle = ({
    label,
    on,
    set,
  }: {
    label: string;
    on: boolean;
    set: (v: boolean) => void;
  }) => (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 14px',
        cursor: 'pointer',
        borderBottom: '1px solid var(--customer-border-subtle, #F3F1EE)',
      }}
    >
      <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--customer-text, #2C2118)' }}>
        {label}
      </span>
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => set(e.target.checked)}
        style={{
          width: 20,
          height: 20,
          accentColor: '#A96F22',
          cursor: 'pointer',
        }}
      />
    </label>
  );

  if (changingPhone) {
    return (
      <ChangePhoneScreen
        currentMasked={phone || null}
        onDone={() => {
          setChangingPhone(false);
          setPhoneVerified(true);
        }}
        onCancel={() => setChangingPhone(false)}
      />
    );
  }

  return (
    <div className="owner-menu" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Executive Header */}
      <header className="owner-notification-header">
        <button
          onClick={() => nav(-1)}
          aria-label="Back"
          className='customer-back'
        
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        <div className="owner-notification-title-wrap">
          <h1 className="owner-serif">My Information</h1>
        </div>
      </header>

      {/* Personal Details Section Card */}
      <section className="owner-menu-section">
        <div className="owner-menu-section-head">
          <h6>PERSONAL DETAILS</h6>
          <p>Account identity and contact details</p>
        </div>

        <div className="owner-menu-card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <label className="cust-label" style={{ flex: 1, fontSize: 13, fontWeight: 700, color: '#5D5348' }}>
              First name
              <input
                style={fieldStyle}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First"
              />
            </label>
            <label className="cust-label" style={{ flex: 1, fontSize: 13, fontWeight: 700, color: '#5D5348' }}>
              Last name
              <input
                style={fieldStyle}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last"
              />
            </label>
          </div>

          <label className="cust-label" style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#5D5348' }}>
            Birthday
            <input
              style={fieldStyle}
              type="date"
              aria-label="Birthday"
              value={birthday}
              onChange={(e) => setBirthday(e.target.value)}
            />
          </label>

          {/* Phone Field Box */}
          <div>
            <div className="cust-label" style={{ fontSize: 13, fontWeight: 700, color: '#5D5348' }}>
              Phone
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                padding: '10px 14px',
                border: '1px solid var(--customer-border, #E9DAC4)',
                borderRadius: 12,
                background: 'var(--customer-card, #FFFFFF)',
                marginTop: 6,
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 600, color: '#2C2118' }}>
                {phone || 'Not set'}
                {phone ? (
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 11.5,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 12,
                      background: phoneVerified ? 'rgba(49, 144, 90, 0.12)' : 'rgba(206, 138, 44, 0.12)',
                      color: phoneVerified ? '#31905A' : '#A96F22',
                    }}
                  >
                    {phoneVerified ? 'Verified' : 'Unverified'}
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                onClick={() => setChangingPhone(true)}
                style={{
                  background: 'none',
                  border: 0,
                  color: '#A96F22',
                  fontSize: 13.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Change
              </button>
            </div>
          </div>

          {phone.trim() ? (
            phoneVerified ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  color: '#31905A',
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                <FiCheckCircle size={15} /> Phone verified
              </div>
            ) : (
              <div>
                {!verifyOpen ? (
                  <button
                    type="button"
                    onClick={sendCode}
                    disabled={verifyBusy}
                    style={{
                      border: '1px solid #A96F22',
                      background: '#FFFFFF',
                      color: '#A96F22',
                      borderRadius: 10,
                      padding: '8px 16px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                  >
                    {verifyBusy ? 'Sending…' : 'Verify number'}
                  </button>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div className="cust-sub" style={{ fontSize: 12.5 }}>
                      Enter the code we texted to {phone.trim()}.
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        inputMode="numeric"
                        placeholder="6-digit code"
                        aria-label="Verification code"
                        style={{ ...fieldStyle, marginTop: 0, flex: 1 }}
                      />
                      <button
                        type="button"
                        onClick={confirmCode}
                        disabled={verifyBusy || !code.trim()}
                        className="cust-btn"
                        style={{
                          width: 'auto',
                          height: 46,
                          padding: '0 18px',
                          background: '#A96F22',
                          color: '#FFF',
                          borderRadius: 12,
                          border: 0,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {verifyBusy ? '…' : 'Verify'}
                      </button>
                    </div>
                  </div>
                )}
                {verifyErr ? (
                  <div className="cust-sub" style={{ color: 'var(--customer-red, #D35A50)', marginTop: 6 }}>
                    {verifyErr}
                  </div>
                ) : null}
              </div>
            )
          ) : null}

          <label className="cust-label" style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#5D5348' }}>
            Email
            <input
              style={fieldStyle}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              inputMode="email"
              placeholder="you@example.com"
            />
          </label>
        </div>
      </section>

      {/* Notifications / Communication Section Card */}
      <section className="owner-menu-section">
        <div className="owner-menu-section-head">
          <h6>COMMUNICATION PREFERENCES</h6>
          <p>Manage SMS, email and marketing alerts</p>
        </div>

        <div className="owner-menu-card" style={{ padding: '4px 0' }}>
          <Toggle label="SMS notifications" on={sms} set={setSms} />
          <Toggle label="Email notifications" on={emailOpt} set={setEmailOpt} />
          <Toggle label="Marketing offers" on={marketing} set={setMarketing} />
        </div>
      </section>

      {ok ? (
        <div
          className="cust-card"
          style={{
            padding: 14,
            background: '#EDF8F0',
            color: '#31905A',
            border: '1px solid #C8E8D2',
            borderRadius: 14,
            fontWeight: 600,
            fontSize: 14,
            textAlign: 'center',
          }}
        >
          Profile updated.
        </div>
      ) : null}
      {error ? (
        <div
          className="cust-card"
          style={{
            padding: 14,
            background: '#FFF0EF',
            color: '#D35A50',
            border: '1px solid #F6C8C4',
            borderRadius: 14,
            fontWeight: 600,
            fontSize: 14,
            textAlign: 'center',
          }}
        >
          {error}
        </div>
      ) : null}

      <button
        className="cust-btn"
        disabled={busy}
        onClick={save}
        style={{
          height: 48,
          borderRadius: 14,
          background: 'linear-gradient(135deg, #A96F22 0%, #8B5A18 100%)',
          color: '#FFFFFF',
          fontWeight: 700,
          fontSize: 16,
          border: 'none',
          cursor: 'pointer',
          boxShadow: '0 4px 14px rgba(169, 111, 34, 0.28)',
          marginTop: 6,
        }}
      >
        {busy ? 'Saving…' : 'Save Changes'}
      </button>

      <div className="cust-sub" style={{ fontSize: 12, textAlign: 'center', color: '#89827A' }}>
        Updates only the fields you change.
      </div>
    </div>
  );
}

