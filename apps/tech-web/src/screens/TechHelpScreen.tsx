import { useEffect, useState } from 'react';
import { useTechNav } from '../shell/nav';
import { techApi, type TechWorkplace } from '../api/techApi';

const BackIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

interface FaqItem {
  question: string;
  category: string;
  answer: string;
}

const FAQS: FaqItem[] = [
  {
    category: 'Earnings & Payouts',
    question: 'How and when are my commissions and tips paid out?',
    answer:
      'Your service commissions and client tips are calculated in real-time from completed tickets. You can review your daily breakdown under Earnings and track official payout batches under Payroll & Payouts. Direct deposits are distributed based on your salon’s scheduled pay cycle.',
  },
  {
    category: 'Inventory & Supplies',
    question: 'How do I report low, empty, or damaged products?',
    answer:
      'Go to More → Report a Product. Search for the shade or product, select the issue (e.g., Getting Low, Damaged, Empty), pick the remaining percentage if applicable, and tap Submit. Your manager receives an immediate alert to reorder.',
  },
  {
    category: 'Queue & Break Mode',
    question: 'How does the Turn Queue and Break Mode work?',
    answer:
      'The queue uses an intelligent round-robin fair rotation algorithm based on your active status and completed turns. When taking a rest or meal break, tap "Break Mode" on your dashboard. When you return, turn off Break Mode to resume receiving walk-ins and client assignments.',
  },
  {
    category: 'Bookings & Portfolio',
    question: 'How do clients book me and view my work?',
    answer:
      'Clients can discover your public profile, view your portfolio photos in the Nail Showcase, and select you directly during "Book Now". You can manage your bio, specialty tags, and portfolio pictures under My Profile.',
  },
  {
    category: 'Tickets & Billing',
    question: 'What should I do if a service price needs adjustment?',
    answer:
      'Open the ticket detail from the Tickets tab and tap "Edit Services" to add add-ons or request a service swap. Any major pricing modifications will automatically route to the manager/front desk for quick approval.',
  },
];

export function TechHelpScreen() {
  const nav = useTechNav();

  const [currentSalon, setCurrentSalon] = useState<TechWorkplace | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  // Quick message form
  const [topic, setTopic] = useState('General Question');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentSuccess, setSentSuccess] = useState(false);

  useEffect(() => {
    let alive = true;
    techApi
      .workplaces()
      .then((r) => {
        if (!alive) return;
        const current = r.workplaces.find((w) => w.isCurrentSession) || r.workplaces[0] || null;
        setCurrentSalon(current);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || sending) return;
    setSending(true);
    try {
      await techApi.sendMessageToManager(topic, message.trim());
      setSentSuccess(true);
      setMessage('');
    } catch (err: any) {
      setSendError(err?.message || 'Could not send message to manager.');
    } finally {
      setSending(false);
    }
  };

  const salonName = currentSalon?.salonName || 'Your Salon';

  return (
    <div style={{ padding: '16px 16px 100px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          type="button"
          onClick={() => nav.back()}
          aria-label="Back"
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            border: '1.5px solid rgba(120, 90, 40, 0.18)',
            background: '#FFFFFF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: 'var(--tech-text, #2b2218)',
            boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
            flexShrink: 0,
          }}
        >
          <BackIcon />
        </button>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: 'var(--tech-text, #2b2218)' }}>
            Help & Support
          </h1>
          <div style={{ fontSize: 12, color: 'var(--tech-muted, #8a7c63)', marginTop: 1 }}>
            We're here to assist your daily workflow
          </div>
        </div>
      </div>

      {/* Salon Direct Contact Card */}
      <div
        style={{
          padding: 16,
          borderRadius: 18,
          background: '#FFFFFF',
          border: '1.5px solid rgba(120, 90, 40, 0.16)',
          boxShadow: '0 4px 16px rgba(120, 90, 30, 0.05)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 800,
                color: '#A96F22',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              SALON WORKPLACE
            </span>
            <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--tech-text, #2b2218)', marginTop: 2 }}>
              {salonName}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--tech-muted, #8a7c63)', marginTop: 1 }}>
              Need urgent in-salon help or shift assistance?
            </div>
          </div>

          <span
            style={{
              padding: '3px 9px',
              borderRadius: 999,
              background: 'rgba(16, 185, 129, 0.12)',
              color: '#059669',
              fontSize: 11,
              fontWeight: 800,
            }}
          >
            Active
          </span>
        </div>

        {/* Action Buttons: 2 Equal Width in 1 Row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <a
            href="tel:+18005550199"
            style={{
              height: 42,
              borderRadius: 12,
              border: '1.5px solid rgba(120, 90, 40, 0.20)',
              background: '#FFFFFF',
              color: 'var(--tech-text, #2b2218)',
              fontSize: 13,
              fontWeight: 700,
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              cursor: 'pointer',
            }}
          >
            <span>📞</span>
            <span>Call Reception</span>
          </a>

          <a
            href="sms:+18005550199"
            style={{
              height: 42,
              borderRadius: 12,
              border: 'none',
              background: 'linear-gradient(135deg, #C9971B 0%, #A96F22 100%)',
              color: '#FFFFFF',
              fontSize: 13,
              fontWeight: 700,
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(169, 111, 34, 0.25)',
            }}
          >
            <span>💬</span>
            <span>Message Front Desk</span>
          </a>
        </div>
      </div>

      {/* AI PowerSalon 24/7 Platform Support Card */}
      <div
        style={{
          padding: 16,
          borderRadius: 18,
          background: 'linear-gradient(135deg, rgba(201, 151, 27, 0.08) 0%, rgba(169, 111, 34, 0.03) 100%)',
          border: '1.5px solid rgba(201, 151, 27, 0.35)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 18 }}>✨</span>
            <span style={{ fontWeight: 800, fontSize: 14.5, color: '#A96F22' }}>
              AI PowerSalon Support
            </span>
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#059669' }}>
            🟢 24/7 Online
          </span>
        </div>

        <div style={{ fontSize: 12.5, color: 'var(--tech-text, #2b2218)', lineHeight: 1.45 }}>
          For technical bugs, payment gateway issues, or app assistance, contact our platform specialists.
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 2 }}>
          <a
            href="mailto:support@aipowersalon.com?subject=Technician%20Support%20Request"
            style={{
              flex: 1,
              padding: '9px 12px',
              borderRadius: 10,
              background: '#FFFFFF',
              border: '1px solid rgba(169, 111, 34, 0.25)',
              color: '#A96F22',
              fontSize: 12.5,
              fontWeight: 700,
              textAlign: 'center',
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
            }}
          >
            <span>✉️</span>
            <span>support@aipowersalon.com</span>
          </a>
        </div>
      </div>

      {/* Frequently Asked Questions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--tech-muted, #8a7c63)', paddingLeft: 4 }}>
          FREQUENTLY ASKED QUESTIONS
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {FAQS.map((f, i) => {
            const isOpen = openFaq === i;
            return (
              <div
                key={f.question}
                style={{
                  borderRadius: 14,
                  background: '#FFFFFF',
                  border: '1.5px solid rgba(120, 90, 40, 0.14)',
                  overflow: 'hidden',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
                }}
              >
                <button
                  type="button"
                  onClick={() => setOpenFaq(isOpen ? null : i)}
                  style={{
                    width: '100%',
                    padding: '14px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    background: 'none',
                    border: 'none',
                    textAlign: 'left',
                    cursor: 'pointer',
                    color: 'var(--tech-text, #2b2218)',
                  }}
                >
                  <span style={{ fontWeight: 700, fontSize: 13.5, flex: 1 }}>
                    {f.question}
                  </span>
                  <span
                    style={{
                      fontSize: 18,
                      fontWeight: 700,
                      color: '#A96F22',
                      transform: isOpen ? 'rotate(45deg)' : 'rotate(0deg)',
                      transition: 'transform 0.15s ease',
                    }}
                  >
                    +
                  </span>
                </button>

                {isOpen && (
                  <div
                    style={{
                      padding: '0 16px 14px',
                      fontSize: 13,
                      lineHeight: 1.5,
                      color: 'var(--tech-muted, #5D5348)',
                      borderTop: '1px solid rgba(120, 90, 40, 0.08)',
                      paddingTop: 10,
                    }}
                  >
                    {f.answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Send Inquiry to Manager */}
      <div
        style={{
          padding: 16,
          borderRadius: 18,
          background: '#FFFFFF',
          border: '1.5px solid rgba(120, 90, 40, 0.16)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--tech-text, #2b2218)' }}>
          Send Message to Manager
        </div>

        {sendError ? <div className="error" role="alert" style={{ marginBottom: 8 }}>{sendError}</div> : null}
          {sentSuccess ? (
          <div
            style={{
              padding: 14,
              borderRadius: 12,
              background: 'rgba(16, 185, 129, 0.12)',
              border: '1.5px solid #10B981',
              color: '#065F46',
              fontSize: 13,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>✓ Message sent to {salonName} management!</span>
            <button
              type="button"
              onClick={() => setSentSuccess(false)}
              style={{
                background: 'none',
                border: 'none',
                color: '#065F46',
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              Send another
            </button>
          </div>
        ) : (
          <form onSubmit={handleSendMessage} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--tech-muted, #8a7c63)', display: 'block', marginBottom: 6 }}>
                SELECT TOPIC
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {[
                  { id: 'Schedule & Hours', label: '📅 Schedule' },
                  { id: 'Payroll & Commission', label: '💰 Payroll' },
                  { id: 'Equipment & Products', label: '📦 Products' },
                  { id: 'Ticket Adjustment', label: '🧾 Tickets' },
                  { id: 'General Question', label: '💬 General' },
                ].map((t) => {
                  const isSelected = topic === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTopic(t.id)}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 10,
                        border: isSelected ? '1.5px solid #A96F22' : '1px solid rgba(120, 90, 40, 0.18)',
                        background: isSelected ? 'rgba(169, 111, 34, 0.12)' : '#FFFFFF',
                        color: isSelected ? '#A96F22' : 'var(--tech-text, #2b2218)',
                        fontWeight: isSelected ? 800 : 600,
                        fontSize: 12.5,
                        cursor: 'pointer',
                        transition: 'all 0.12s ease',
                      }}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--tech-muted, #8a7c63)', display: 'block', marginBottom: 4 }}>
                MESSAGE
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                placeholder="Write your note or question for the manager..."
                required
                style={{
                  width: '100%',
                  padding: 10,
                  borderRadius: 12,
                  border: '1.5px solid rgba(120, 90, 40, 0.20)',
                  fontSize: 13.5,
                  resize: 'none',
                  fontFamily: 'inherit',
                  color: 'var(--tech-text, #2b2218)',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <button
              type="submit"
              disabled={sending || !message.trim()}
              style={{
                height: 44,
                borderRadius: 12,
                border: 'none',
                background: 'linear-gradient(135deg, #C9971B 0%, #A96F22 100%)',
                color: '#FFFFFF',
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(169, 111, 34, 0.25)',
                opacity: !message.trim() ? 0.6 : 1,
              }}
            >
              {sending ? 'Sending…' : 'Send Message'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
