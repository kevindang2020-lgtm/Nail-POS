import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { customerApi, type CustomerSalonInfo } from '../api/customerApi';
import { apptWhen, bucketOf } from '../lib/appt';

// AI Receptionist — a customer-facing virtual receptionist. There is no customer LLM endpoint (the /ai assistant is
// tenant-gated and billed to the salon), so this assistant is deterministic and grounded ONLY in the customer's real
// data: appointments, live queue, salon info, deals, and loyalty. It never invents hours, availability, or pricing —
// for anything it can't answer it escalates to calling the salon (real phone number).
type Action = { label: string; run: () => void };
type Msg = { id: string; role: 'bot' | 'user'; text: string; time: string; actions?: Action[] };

const QUICK_OPTIONS = [
  { label: 'My next appointment', icon: '📅' },
  { label: 'My place in line', icon: '⏱️' },
  { label: 'Hours & location', icon: '📍' },
  { label: "Today's deals", icon: '🏷️' },
  { label: 'My rewards', icon: '⭐' },
  { label: 'Book an appointment', icon: '💅' },
];

const GREETING = "Hi! I'm your salon's virtual receptionist. I can check your appointments, your place in line, today's deals, hours & location, and your rewards. How can I help?";

const ACTION_ICONS: Record<string, string> = {
  'Book an appointment': '💅',
  'View live queue': '⏱️',
  'Check in': '🎟️',
  'View details': '📅',
  'All appointments': '📋',
  'Directions': '📍',
  '📞 Call': '📞',
  '💬 Message': '💬',
  'See all deals': '🏷️',
  'View rewards': '⭐',
};

function formatNow(): string {
  const d = new Date();
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

export function AIReceptionistScreen() {
  const nav = useNavigate();
  const [msgs, setMsgs] = useState<Msg[]>([
    { id: 'greet-1', role: 'bot', text: GREETING, time: formatNow() },
  ]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const salonRef = useRef<CustomerSalonInfo | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [msgs, pending]);

  const push = (m: Omit<Msg, 'id' | 'time'>) => {
    setMsgs((x) => [...x, { ...m, id: `${Date.now()}-${Math.random()}`, time: formatNow() }]);
  };

  const getSalon = async () => {
    if (salonRef.current) return salonRef.current;
    try {
      const s = await customerApi.salon();
      salonRef.current = s;
      return s;
    } catch {
      return null;
    }
  };

  const callActions = async (): Promise<Action[]> => {
    const s = await getSalon();
    const tel = (s?.phone || '').replace(/[^0-9+]/g, '');
    if (!tel) return [];
    return [
      { label: '📞 Call', run: () => { window.location.href = `tel:${tel}`; } },
      { label: '💬 Message', run: () => { window.location.href = `sms:${tel}`; } },
    ];
  };

  const answer = async (text: string) => {
    const t = text.toLowerCase();
    try {
      if (/\b(book|reserve|schedule)\b/.test(t) && !/(my|the) (appointment|booking)\b/.test(t)) {
        return push({
          role: 'bot',
          text: 'I can take you to booking to choose a service, date, and technician.',
          actions: [{ label: 'Book an appointment', run: () => nav('/book') }],
        });
      }
      if (/\b(queues?|lines?|wait|how long|positions?|place)\b/.test(t)) {
        const q = await customerApi.queue();
        if (q.inQueue) {
          return push({
            role: 'bot',
            text: `You're #${q.position}${q.totalWaiting ? ` of ${q.totalWaiting}` : ''} in line — about ${q.estimatedWaitMinMinutes}–${q.estimatedWaitMaxMinutes} minutes.`,
            actions: [{ label: 'View live queue', run: () => nav('/queue') }],
          });
        }
        return push({
          role: 'bot',
          text: "You're not in line right now. When you arrive at the salon you can check in to join the queue.",
          actions: [{ label: 'Check in', run: () => nav('/check-in') }],
        });
      }
      if (/\b(appointments?|bookings?|visits?|scheduled|reschedul)/.test(t)) {
        const list = await customerApi.appointments();
        const up = list.filter((a) => bucketOf(a.status, a.startTime) === 'upcoming').sort((a, b) => a.startTime.localeCompare(b.startTime))[0];
        if (up) {
          return push({
            role: 'bot',
            text: `Your next appointment is ${up.serviceName || 'a service'} on ${apptWhen(up.startTime)}${up.technicianName ? ` with ${up.technicianName}` : ''}${up.branchName ? ` at ${up.branchName}` : ''}.`,
            actions: [
              { label: 'View details', run: () => nav(`/appointments/${up.appointmentId}`) },
              { label: 'All appointments', run: () => nav('/appointments') },
            ],
          });
        }
        return push({
          role: 'bot',
          text: "You don't have any upcoming appointments. Would you like to book one?",
          actions: [{ label: 'Book an appointment', run: () => nav('/book') }],
        });
      }
      if (/\b(hours?|open|clos|locations?|address|where|directions?|parking|find)/.test(t)) {
        const s = await getSalon();
        if (s && (s.name || s.address)) {
          const acts: Action[] = [];
          if (s.address) acts.push({ label: 'Directions', run: () => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address as string)}`, '_blank') });
          acts.push(...(await callActions()));
          return push({
            role: 'bot',
            text: `${s.name || 'Your salon'}${s.address ? ` is at ${s.address}` : ''}. For today's hours, give them a quick call.`,
            actions: acts,
          });
        }
        return push({ role: 'bot', text: "I couldn't find your salon's location right now." });
      }
      if (/\b(deals?|offers?|promos?|discounts?|coupons?|specials?)\b/.test(t)) {
        const d = await customerApi.deals();
        if (d.length) {
          return push({
            role: 'bot',
            text: `There ${d.length === 1 ? 'is' : 'are'} ${d.length} active offer${d.length > 1 ? 's' : ''}: ${d.slice(0, 3).map((x) => x.title).join('; ')}${d.length > 3 ? ', and more' : ''}.`,
            actions: [{ label: 'See all deals', run: () => nav('/deals') }],
          });
        }
        return push({ role: 'bot', text: 'There are no active deals right now — check back soon!' });
      }
      if (/\b(rewards?|points?|loyalty|tiers?|balances?)\b/.test(t)) {
        const l = await customerApi.loyalty();
        return push({
          role: 'bot',
          text: `You have ${l.points.toLocaleString('en-US')} points — ${l.tier} member${l.nextTier ? `. ${l.pointsToNextTier.toLocaleString('en-US')} pts to ${l.nextTier}` : ' (top tier 🎉)'}.`,
          actions: [{ label: 'View rewards', run: () => nav('/rewards') }],
        });
      }
      if (/\b(call|phone|talk|human|person|contact|reach|speak)\b/.test(t)) {
        const acts = await callActions();
        if (acts.length) return push({ role: 'bot', text: `You can reach ${salonRef.current?.name || 'the salon'} directly:`, actions: acts });
        return push({ role: 'bot', text: "I don't have a phone number on file for the salon right now." });
      }
      return push({ role: 'bot', text: 'I can help with your appointments, your place in line, hours & location, current deals, and your rewards. Tap a suggestion below or ask me anything about your visit.' });
    } catch {
      return push({ role: 'bot', text: "Sorry — I couldn't pull that up just now. You can try again, or reach the salon directly.", actions: await callActions() });
    }
  };

  const send = async (text: string) => {
    const v = text.trim();
    if (!v || pending) return;
    push({ role: 'user', text: v });
    setInput('');
    setPending(true);
    try {
      await answer(v);
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - var(--customer-nav-h, 64px) - env(safe-area-inset-bottom, 0px) - env(safe-area-inset-top, 47px))',
        maxHeight: 'calc(100vh - var(--customer-nav-h, 64px) - env(safe-area-inset-bottom, 0px) - env(safe-area-inset-top, 47px))',
        overflow: 'hidden',
        position: 'relative',
        background: 'var(--customer-background)',
      }}
    >
      {/* Sticky Luxury Header */}
      <div
        style={{
          flexShrink: 0,
          background: 'var(--customer-background)',
          borderBottom: '1px solid rgba(233, 218, 196, 0.8)',
          padding: '12px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          zIndex: 10,
        }}
      >
        <button
          onClick={() => nav(-1)}
          aria-label="Back"
          className="customer-back"
          style={{ width: 38, height: 38 }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #DFC37B, #A96F22 70%, #84561A)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: 20,
              boxShadow: '0 4px 14px rgba(169, 111, 34, 0.25)',
              border: '2px solid #FFFFFF',
            }}
          >
            ✨
          </div>
          <span
            style={{
              position: 'absolute',
              bottom: 1,
              right: 1,
              width: 11,
              height: 11,
              borderRadius: '50%',
              background: '#10B981',
              border: '2px solid #FFFFFF',
              boxShadow: '0 0 6px rgba(16, 185, 129, 0.6)',
            }}
            title="Online"
          />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <h1 className="cust-h1" style={{ fontSize: 17, color: 'var(--customer-text)' }}>
              AI Receptionist
            </h1>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                background: 'linear-gradient(135deg, #FBF1DD, #F7E8C8)',
                color: '#84561A',
                padding: '2px 7px',
                borderRadius: 999,
                border: '1px solid #DFC37B',
                letterSpacing: 0.4,
                textTransform: 'uppercase',
              }}
            >
              24/7 Concierge
            </span>
          </div>
          <div className="cust-sub" style={{ fontSize: 12, marginTop: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10B981', display: 'inline-block' }} />
            Answers from your account &amp; salon info
          </div>
        </div>
      </div>

      {/* Scrollable Messages Area */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 16px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {msgs.map((m) => {
          const isUser = m.role === 'user';
          return (
            <div
              key={m.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: isUser ? 'flex-end' : 'flex-start',
                gap: 5,
              }}
            >
              {/* Message Header Label */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: isUser ? '0 4px' : '0 2px',
                  fontSize: 11,
                  fontWeight: 700,
                  color: isUser ? '#84561A' : 'var(--customer-text-secondary)',
                  letterSpacing: 0.3,
                  textTransform: 'uppercase',
                }}
              >
                {!isUser && <span style={{ color: '#A96F22' }}>✨ AI Concierge</span>}
                {isUser && <span>You</span>}
                <span style={{ fontSize: 10.5, fontWeight: 500, opacity: 0.6, textTransform: 'none' }}>
                  {m.time}
                </span>
              </div>

              {/* Message Bubble */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  maxWidth: isUser ? '84%' : '90%',
                }}
              >
                {!isUser && (
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, #FBF1DD, #F7E8C8)',
                      border: '1px solid #DFC37B',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 13,
                      flexShrink: 0,
                      marginTop: 2,
                    }}
                  >
                    ✨
                  </div>
                )}

                <div
                  style={{
                    padding: '12px 16px',
                    borderRadius: 20,
                    fontSize: 14.5,
                    lineHeight: 1.5,
                    background: isUser
                      ? 'linear-gradient(135deg, #C9971B 0%, #A96F22 65%, #84561A 100%)'
                      : '#FFFFFF',
                    color: isUser ? '#FFFFFF' : '#2A2118',
                    border: isUser ? 'none' : '1px solid rgba(233, 218, 196, 0.8)',
                    boxShadow: isUser
                      ? '0 6px 18px rgba(169, 111, 34, 0.28)'
                      : '0 4px 14px rgba(42, 33, 24, 0.04)',
                    borderTopRightRadius: isUser ? 4 : 20,
                    borderTopLeftRadius: isUser ? 20 : 4,
                  }}
                >
                  {m.text}
                </div>
              </div>

              {/* Action Buttons for Bot Responses */}
              {m.actions && m.actions.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 8,
                    marginTop: 4,
                    marginLeft: isUser ? 0 : 36,
                  }}
                >
                  {m.actions.map((a, j) => {
                    const icon = ACTION_ICONS[a.label] || '→';
                    return (
                      <button
                        key={j}
                        onClick={a.run}
                        aria-label={a.label}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          background: '#FFFFFF',
                          color: '#84561A',
                          border: '1.5px solid #DFC37B',
                          fontWeight: 700,
                          fontSize: 13,
                          borderRadius: 999,
                          padding: '7px 14px',
                          cursor: 'pointer',
                          boxShadow: '0 2px 8px rgba(201, 151, 27, 0.12)',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <span aria-hidden="true">{icon}</span>
                        <span>{a.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* Typing indicator */}
        {pending && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 2 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #FBF1DD, #F7E8C8)',
                border: '1px solid #DFC37B',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                flexShrink: 0,
              }}
            >
              ✨
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '12px 18px',
                borderRadius: 20,
                borderTopLeftRadius: 4,
                background: '#FFFFFF',
                border: '1px solid rgba(233, 218, 196, 0.8)',
                boxShadow: '0 4px 12px rgba(42, 33, 24, 0.04)',
              }}
              aria-label="Typing"
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#A96F22', opacity: 0.7 }} />
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#C9971B', opacity: 0.7 }} />
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#84561A', opacity: 0.7 }} />
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* Pinned Solid Composer directly above bottom navigation */}
      <div
        style={{
          flexShrink: 0,
          background: 'var(--customer-background)',
          borderTop: '1px solid rgba(233, 218, 196, 0.8)',
          boxShadow: '0 -4px 16px rgba(120, 90, 30, 0.06)',
          zIndex: 10,
        }}
      >
        {/* Quick Suggestion Pills */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            overflowX: 'auto',
            padding: '10px 14px 4px',
            scrollbarWidth: 'none',
          }}
        >
          {QUICK_OPTIONS.map((qc) => (
            <button
              key={qc.label}
              aria-label={qc.label}
              onClick={() => send(qc.label)}
              disabled={pending}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                whiteSpace: 'nowrap',
                border: '1px solid #E9DAC4',
                background: '#FFFFFF',
                color: 'var(--customer-text)',
                fontWeight: 600,
                fontSize: 12.5,
                borderRadius: 999,
                padding: '7px 13px',
                cursor: pending ? 'default' : 'pointer',
                opacity: pending ? 0.5 : 1,
                boxShadow: '0 1px 4px rgba(0,0,0,0.03)',
                transition: 'all 0.15s ease',
              }}
            >
              <span aria-hidden="true">{qc.icon}</span>
              <span>{qc.label}</span>
            </button>
          ))}
        </div>

        {/* Input Bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px 12px' }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send(input);
            }}
            placeholder="Ask about appointments, wait time, deals…"
            aria-label="Message the receptionist"
            style={{
              flex: 1,
              height: 46,
              borderRadius: 999,
              border: '1.5px solid #E9DAC4',
              padding: '0 18px',
              font: 'inherit',
              fontSize: 14,
              background: '#FFFFFF',
              color: 'var(--customer-text)',
              outline: 'none',
              boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.04)',
            }}
            onFocus={(e) => (e.target.style.borderColor = '#C9971B')}
            onBlur={(e) => (e.target.style.borderColor = '#E9DAC4')}
          />
          <button
            type="button"
            onClick={() => send(input)}
            disabled={pending || !input.trim()}
            aria-label="Send"
            style={{
              width: 46,
              height: 46,
              borderRadius: '50%',
              border: 'none',
              background: pending || !input.trim()
                ? '#E5E7EB'
                : 'linear-gradient(135deg, #C9971B, #A96F22)',
              color: pending || !input.trim() ? '#9CA3AF' : '#FFFFFF',
              cursor: pending || !input.trim() ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              boxShadow: pending || !input.trim()
                ? 'none'
                : '0 4px 12px rgba(169, 111, 34, 0.3)',
              transition: 'all 0.15s ease',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
