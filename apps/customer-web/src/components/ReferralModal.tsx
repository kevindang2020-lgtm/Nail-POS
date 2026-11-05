import React, { useEffect, useState } from 'react';
import { customerApi, CustomerReferral } from '../api/customerApi';
import { isGuest, exitGuestMode } from '../auth/guest';

interface ReferralModalProps {
  open: boolean;
  onClose: () => void;
}

export function ReferralModal({ open, onClose }: ReferralModalProps) {
  const guest = isGuest();
  const [refData, setRefData] = useState<CustomerReferral | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!open || guest) return;
    setLoading(true);
    customerApi
      .referral()
      .then((data) => {
        if (data) setRefData(data);
      })
      .catch(() => {
        // Fallback fallback code if network error
        setRefData({
          code: 'AIPOWER10',
          shareMessage: 'Book your next appointment with me on AI PowerSalon! Use my code AIPOWER10 when you sign up to get $10 in rewards.',
        });
      })
      .finally(() => setLoading(false));
  }, [open, guest]);

  if (!open) return null;

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const getPublicBaseUrl = () => {
    if (typeof window !== 'undefined' && window.location.origin.startsWith('http') && !window.location.origin.includes('localhost')) {
      return window.location.origin;
    }
    return 'https://app.aipowersalon.com:8083';
  };

  const code = refData?.code || 'AIPOWER10';
  const publicUrl = `${getPublicBaseUrl()}?ref=${encodeURIComponent(code)}`;
  const shareText = `Get $10 off your first appointment at AI PowerSalon! Use my invite code ${code} when booking: ${publicUrl}`;

  const copyCode = async () => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(code);
      }
      setCopiedCode(true);
      showToast('Referral code copied to clipboard! 🎉');
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      showToast(`Your code is: ${code}`);
    }
  };

  const copyLink = async () => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(publicUrl);
      }
      setCopiedLink(true);
      showToast('Invite link copied to clipboard! 📋');
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      showToast(`Link: ${publicUrl}`);
    }
  };

  const handleNativeShare = async () => {
    if (typeof navigator !== 'undefined' && (navigator as any).share) {
      try {
        await (navigator as any).share({
          title: 'AI PowerSalon - $10 Reward',
          text: shareText,
          url: publicUrl,
        });
        showToast('Shared successfully!');
        return;
      } catch (err: any) {
        if (err?.name === 'AbortError') return; // User closed share sheet
      }
    }
    // Fallback if Web Share API not available or throws
    copyLink();
  };

  const shareSMS = () => {
    const smsUrl = `sms:?&body=${encodeURIComponent(shareText)}`;
    window.location.href = smsUrl;
  };

  const shareWhatsApp = () => {
    const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`;
    window.open(waUrl, '_blank');
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(20, 16, 12, 0.65)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 400,
          background: '#FFFDF9',
          borderRadius: 24,
          padding: '26px 22px 22px',
          boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
          border: '1px solid #E7DCC9',
          textAlign: 'center',
          position: 'relative',
          maxHeight: '92vh',
          overflowY: 'auto',
          animation: 'guestPop .22s ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          type="button"
          aria-label="Close"
          style={{
            position: 'absolute',
            top: 14,
            right: 14,
            width: 32,
            height: 32,
            borderRadius: '50%',
            border: 'none',
            background: 'rgba(0,0,0,0.06)',
            color: '#70604E',
            fontSize: 16,
            fontWeight: 700,
            cursor: 'pointer',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          ✕
        </button>

        {/* Gift Icon Header */}
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #FBF3E4 0%, #EFE1C9 100%)',
            display: 'grid',
            placeItems: 'center',
            margin: '0 auto 12px',
            border: '1px solid #DBCAB0',
            boxShadow: '0 4px 14px rgba(169,111,34,.18)',
            fontSize: 32,
          }}
        >
          🎁
        </div>

        <h3
          style={{
            fontFamily: 'Georgia, serif',
            fontSize: 22,
            fontWeight: 800,
            color: '#2A2118',
            margin: '0 0 6px',
          }}
        >
          Refer a Friend, Earn Rewards!
        </h3>

        <div
          style={{
            display: 'inline-block',
            padding: '4px 14px',
            borderRadius: 999,
            background: '#F4EAE0',
            color: '#8A5D22',
            fontWeight: 700,
            fontSize: 13,
            marginBottom: 12,
          }}
        >
          Give $10, Get $10
        </div>

        <p
          style={{
            fontSize: 13.5,
            lineHeight: 1.5,
            color: '#70604E',
            margin: '0 0 18px',
          }}
        >
          Share your referral code with friends. When they sign up and complete their first salon appointment,{' '}
          <strong style={{ color: '#2A2118' }}>you both receive $10</strong> in rewards!
        </p>

        {guest ? (
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div
              style={{
                background: '#FBF7F0',
                border: '1px dashed #D5C5B0',
                borderRadius: 14,
                padding: '16px 12px',
                fontSize: 13,
                color: '#8A7A66',
              }}
            >
              Sign in or create an account to get your personal referral code and track your rewards.
            </div>
            <button
              type="button"
              onClick={() => {
                onClose();
                exitGuestMode();
              }}
              style={{
                height: 46,
                borderRadius: 12,
                border: 'none',
                background: 'linear-gradient(180deg, #C9971B 0%, #A96F22 100%)',
                color: '#fff',
                fontWeight: 700,
                fontSize: 14,
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(169,111,34,.25)',
              }}
            >
              Sign In or Register
            </button>
          </div>
        ) : (
          <>
            {/* Referral Code Box */}
            <div
              style={{
                background: 'linear-gradient(135deg, #FDFBF7 0%, #F5ECE0 100%)',
                border: '1.5px dashed #C9971B',
                borderRadius: 16,
                padding: '14px 16px',
                marginBottom: 18,
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: '1px',
                  color: '#9C6E2E',
                  textTransform: 'uppercase',
                  marginBottom: 6,
                }}
              >
                Your Referral Code
              </div>

              {loading ? (
                <div style={{ fontSize: 18, fontWeight: 700, color: '#A09080', padding: '6px 0' }}>
                  Loading code…
                </div>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 12,
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 22,
                      fontWeight: 800,
                      letterSpacing: '1.5px',
                      color: '#2A2118',
                      userSelect: 'all',
                    }}
                  >
                    {code}
                  </span>
                  <button
                    type="button"
                    onClick={copyCode}
                    style={{
                      padding: '6px 14px',
                      borderRadius: 10,
                      border: 'none',
                      background: copiedCode ? '#0E8A63' : '#2A2118',
                      color: '#fff',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'background 0.2s ease',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {copiedCode ? '✓ Copied!' : 'Copy Code'}
                  </button>
                </div>
              )}
            </div>

            {/* Main Action Buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                type="button"
                onClick={handleNativeShare}
                style={{
                  height: 46,
                  borderRadius: 12,
                  border: 'none',
                  background: 'linear-gradient(180deg, #C9971B 0%, #A96F22 100%)',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  boxShadow: '0 4px 14px rgba(169,111,34,.25)',
                }}
              >
                <span>🚀</span>
                <span>Share Invite with Friends</span>
              </button>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <button
                  type="button"
                  onClick={shareSMS}
                  style={{
                    height: 42,
                    borderRadius: 12,
                    border: '1px solid #DBCAB0',
                    background: '#FFFDF9',
                    color: '#2A2118',
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  <span>💬</span>
                  <span>Text / SMS</span>
                </button>

                <button
                  type="button"
                  onClick={shareWhatsApp}
                  style={{
                    height: 42,
                    borderRadius: 12,
                    border: '1px solid #25D366',
                    background: '#E8F8EE',
                    color: '#075E54',
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  <span>🟢</span>
                  <span>WhatsApp</span>
                </button>
              </div>

              <button
                type="button"
                onClick={copyLink}
                style={{
                  height: 38,
                  borderRadius: 10,
                  border: 'none',
                  background: 'transparent',
                  color: copiedLink ? '#0E8A63' : '#8A5D22',
                  fontWeight: 600,
                  fontSize: 12.5,
                  cursor: 'pointer',
                }}
              >
                {copiedLink ? '✓ Invite Link Copied!' : '🔗 Copy Direct Invite Link'}
              </button>
            </div>

            {/* How it works info */}
            <div
              style={{
                marginTop: 18,
                paddingTop: 16,
                borderTop: '1px solid #EFE6D8',
                textAlign: 'left',
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: '0.8px',
                  color: '#9C6E2E',
                  textTransform: 'uppercase',
                  marginBottom: 8,
                }}
              >
                How It Works
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: '#5C4E3E' }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <span>1️⃣</span>
                  <span>Send your invite code or link to friends.</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <span>2️⃣</span>
                  <span>Friend signs up & books their first salon service.</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <span>3️⃣</span>
                  <span>Both of you get <strong>$10 in rewards</strong> to spend at the salon!</span>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Floating Toast */}
        {toast && (
          <div
            style={{
              position: 'fixed',
              bottom: 24,
              left: '50%',
              transform: 'translateX(-50%)',
              background: '#2A2118',
              color: '#fff',
              padding: '10px 20px',
              borderRadius: 30,
              fontSize: 13,
              fontWeight: 600,
              boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
              zIndex: 10000,
              animation: 'guestPop .15s ease-out',
            }}
          >
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}

