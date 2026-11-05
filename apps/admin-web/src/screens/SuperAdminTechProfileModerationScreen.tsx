// SuperAdminTechProfileModerationScreen.tsx — Super Admin → Business Management → Tech Profiles
// Centralized oversight of technician profiles: verification decisions, badge provisioning, and DM abuse moderation.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FiAward,
  FiCheckCircle,
  FiShield,
  FiAlertTriangle,
  FiMessageSquare,
  FiUser,
  FiStar,
  FiImage,
  FiCheck,
  FiX,
  FiRefreshCw,
  FiSlash,
  FiSearch,
  FiInfo,
} from 'react-icons/fi';
import {
  superAdminTechProfileApi,
  type SaTechVerification,
  type SaTechDmReport,
} from '../api/superAdminTechProfileApi';

const LINE = 'var(--line, #E9DAC4)';
const TEXT = 'var(--text, #2C2118)';
const MUTED = 'var(--muted, #9B8B78)';
const CARD_BG = 'var(--card, #FFFCF6)';

const cardStyle: React.CSSProperties = {
  background: CARD_BG,
  border: `1px solid ${LINE}`,
  borderRadius: 14,
  boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)',
};

const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

const timeAgo = (iso: string | null) => {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '—';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString();
};

export function SuperAdminTechProfileModerationScreen() {
  const [verifications, setVerifications] = useState<SaTechVerification[] | null>(null);
  const [reports, setReports] = useState<SaTechDmReport[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'verifications' | 'reports' | 'guidelines'>('verifications');
  const [search, setSearch] = useState('');

  // Modals for confirmed actions
  const [rejectTarget, setRejectTarget] = useState<SaTechVerification | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [blockTarget, setBlockTarget] = useState<SaTechDmReport | null>(null);

  const load = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    setErr(null);
    try {
      const [vRes, rRes] = await Promise.all([
        superAdminTechProfileApi.verifications(),
        superAdminTechProfileApi.dmReports(),
      ]);
      setVerifications(vRes.verifications || []);
      setReports(rRes.reports || []);
    } catch (e: any) {
      setErr(e?.message || 'Failed to load technician moderation queue.');
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (key: string, fn: () => Promise<unknown>, successMsg?: string) => {
    setBusy(key);
    setErr(null);
    setSuccess(null);
    try {
      await fn();
      if (successMsg) setSuccess(successMsg);
      await load(true);
    } catch (e: any) {
      setErr(e?.message || 'Action failed.');
    } finally {
      setBusy(null);
    }
  };

  const handleVerify = (v: SaTechVerification) => {
    act(
      `verify-${v.profileId}`,
      () => superAdminTechProfileApi.setVerification(v.profileId, 'verified'),
      `Successfully granted verified status to ${v.displayName}.`
    );
  };

  const handleConfirmReject = () => {
    if (!rejectTarget) return;
    const { profileId, displayName } = rejectTarget;
    act(
      `reject-${profileId}`,
      () => superAdminTechProfileApi.setVerification(profileId, 'unverified', rejectNote.trim() || undefined),
      `Rejected verification request for ${displayName}.`
    );
    setRejectTarget(null);
    setRejectNote('');
  };

  const handleDismissReport = (r: SaTechDmReport) => {
    act(
      `dismiss-${r.reportId}`,
      () => superAdminTechProfileApi.resolveDmReport(r.reportId, 'dismiss'),
      `Report dismissed.`
    );
  };

  const handleConfirmBlock = () => {
    if (!blockTarget) return;
    const { reportId, technicianName } = blockTarget;
    act(
      `block-${reportId}`,
      () => superAdminTechProfileApi.resolveDmReport(reportId, 'block_thread'),
      `Conversation thread blocked for technician ${technicianName || 'specified'}.`
    );
    setBlockTarget(null);
  };

  const vCount = verifications?.length ?? 0;
  const rCount = reports?.length ?? 0;

  // Search filtering
  const filteredVerifications = useMemo(() => {
    if (!verifications) return [];
    if (!search.trim()) return verifications;
    const q = search.toLowerCase();
    return verifications.filter(
      (v) =>
        v.displayName.toLowerCase().includes(q) ||
        v.publicSlug.toLowerCase().includes(q)
    );
  }, [verifications, search]);

  const filteredReports = useMemo(() => {
    if (!reports) return [];
    if (!search.trim()) return reports;
    const q = search.toLowerCase();
    return reports.filter(
      (r) =>
        (r.technicianName && r.technicianName.toLowerCase().includes(q)) ||
        r.reportedBy.toLowerCase().includes(q) ||
        (r.reason && r.reason.toLowerCase().includes(q))
    );
  }, [reports, search]);

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between gap-3 items-start lg:items-center">
        <div className="vh" style={{ flex: 1 }}>
          <h1 style={{ fontFamily: 'Playfair Display, serif', fontSize: 24, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            Technician Profiles <span aria-hidden style={{ color: 'var(--gold, #A96F22)' }}>★</span>
          </h1>
          <div className="sub" style={{ fontSize: 12.5, color: MUTED, marginTop: 3 }}>
            Platform-wide technician verification requests, trust & safety moderation, and message report oversight.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, fontSize: 11.5 }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '2px 8px',
                borderRadius: 999,
                background: vCount > 0 ? '#FFF6E5' : '#EAF5EE',
                color: vCount > 0 ? '#C08A2E' : '#3E8F57',
                fontWeight: 700,
                border: `1px solid ${vCount > 0 ? '#E2C686' : '#C3E2CD'}`,
              }}
            >
              ● {vCount} Verification Request{vCount === 1 ? '' : 's'}
            </span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '2px 8px',
                borderRadius: 999,
                background: rCount > 0 ? '#FBEFE9' : '#EAF5EE',
                color: rCount > 0 ? '#B85B4D' : '#3E8F57',
                fontWeight: 700,
                border: `1px solid ${rCount > 0 ? '#F0C9C2' : '#C3E2CD'}`,
              }}
            >
              ● {rCount} Open Message Report{rCount === 1 ? '' : 's'}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn ghost"
            disabled={loading}
            onClick={() => load()}
            style={{ minHeight: 36, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <FiRefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Refreshing…' : '↻ Refresh Queue'}
          </button>
        </div>
      </div>

      {/* Alerts */}
      {err && (
        <div
          style={{
            background: '#FDF2F2',
            border: '1px solid #F8B4B4',
            borderRadius: 10,
            padding: '10px 14px',
            color: '#B85B4D',
            fontSize: 13,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{err}</span>
          <button
            type="button"
            onClick={() => setErr(null)}
            style={{ border: 'none', background: 'none', color: '#B85B4D', cursor: 'pointer', fontWeight: 700 }}
          >
            ✕
          </button>
        </div>
      )}

      {success && (
        <div
          style={{
            background: '#EDF7ED',
            border: '1px solid #C3E2CD',
            borderRadius: 10,
            padding: '10px 14px',
            color: '#3E8F57',
            fontSize: 13,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>✓ {success}</span>
          <button
            type="button"
            onClick={() => setSuccess(null)}
            style={{ border: 'none', background: 'none', color: '#3E8F57', cursor: 'pointer', fontWeight: 700 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* 4 Professional KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Card 1: Pending Verifications */}
        <div
          className="kpi"
          style={{
            ...cardStyle,
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10.5, color: MUTED, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Pending Verifications
            </span>
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'rgba(169, 111, 34, 0.12)',
                border: '1px solid rgba(169, 111, 34, 0.25)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--g7, #A96F22)',
              }}
            >
              <FiAward size={14} />
            </span>
          </div>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 24, fontWeight: 700, color: TEXT, lineHeight: 1.1 }}>
            {vCount}
          </div>
          <div style={{ fontSize: 11, color: vCount > 0 ? '#C08A2E' : '#3E8F57', fontWeight: 600 }}>
            {vCount > 0 ? '▲ Awaiting Super Admin review' : '✓ All submissions reviewed'}
          </div>
        </div>

        {/* Card 2: Open Reports */}
        <div
          className="kpi"
          style={{
            ...cardStyle,
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10.5, color: MUTED, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Open Message Reports
            </span>
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: rCount > 0 ? 'rgba(184, 91, 77, 0.12)' : 'rgba(62, 143, 87, 0.12)',
                border: `1px solid ${rCount > 0 ? 'rgba(184, 91, 77, 0.25)' : 'rgba(62, 143, 87, 0.25)'}`,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: rCount > 0 ? '#B85B4D' : '#3E8F57',
              }}
            >
              <FiAlertTriangle size={14} />
            </span>
          </div>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 24, fontWeight: 700, color: TEXT, lineHeight: 1.1 }}>
            {rCount}
          </div>
          <div style={{ fontSize: 11, color: rCount > 0 ? '#B85B4D' : '#3E8F57', fontWeight: 600 }}>
            {rCount > 0 ? '⚠ Requires safety resolution' : '✓ Zero abuse reports'}
          </div>
        </div>

        {/* Card 3: Safety & Trust Health */}
        <div
          className="kpi"
          style={{
            ...cardStyle,
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10.5, color: MUTED, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Safety & Trust Health
            </span>
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'rgba(62, 143, 87, 0.12)',
                border: '1px solid rgba(62, 143, 87, 0.25)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#3E8F57',
              }}
            >
              <FiShield size={14} />
            </span>
          </div>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 24, fontWeight: 700, color: TEXT, lineHeight: 1.1 }}>
            {rCount === 0 ? '100%' : 'Active Audit'}
          </div>
          <div style={{ fontSize: 11, color: '#3E8F57', fontWeight: 600 }}>
            Real-time chat moderation active
          </div>
        </div>

        {/* Card 4: Verification Standard */}
        <div
          className="kpi"
          style={{
            ...cardStyle,
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10.5, color: MUTED, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Verification Level
            </span>
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'rgba(60, 127, 182, 0.12)',
                border: '1px solid rgba(60, 127, 182, 0.25)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#3C7FB6',
              }}
            >
              <FiCheckCircle size={14} />
            </span>
          </div>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 24, fontWeight: 700, color: TEXT, lineHeight: 1.1 }}>
            Verified Pro
          </div>
          <div style={{ fontSize: 11, color: '#3C7FB6', fontWeight: 600 }}>
            Identity, review & portfolio audit
          </div>
        </div>
      </div>

      {/* Main Panel with Tabs & Search */}
      <section className="panel" style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
        {/* Navigation Tabs + Search Bar Header */}
        <div
          style={{
            background: '#FFF9EF',
            borderBottom: `1px solid ${LINE}`,
            padding: '8px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={() => setActiveTab('verifications')}
              style={{
                padding: '8px 14px',
                borderRadius: 8,
                border: 'none',
                background: activeTab === 'verifications' ? 'var(--grad, linear-gradient(180deg, #F2D892, #D7A646))' : 'transparent',
                color: activeTab === 'verifications' ? '#2C2118' : MUTED,
                fontWeight: activeTab === 'verifications' ? 800 : 600,
                fontSize: 12.5,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: activeTab === 'verifications' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              <FiAward size={14} />
              Verification Requests
              <span
                style={{
                  background: activeTab === 'verifications' ? '#2C2118' : '#E9DAC4',
                  color: activeTab === 'verifications' ? '#FFF' : TEXT,
                  fontSize: 10.5,
                  fontWeight: 800,
                  padding: '1px 6px',
                  borderRadius: 999,
                }}
              >
                {vCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('reports')}
              style={{
                padding: '8px 14px',
                borderRadius: 8,
                border: 'none',
                background: activeTab === 'reports' ? 'var(--grad, linear-gradient(180deg, #F2D892, #D7A646))' : 'transparent',
                color: activeTab === 'reports' ? '#2C2118' : MUTED,
                fontWeight: activeTab === 'reports' ? 800 : 600,
                fontSize: 12.5,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: activeTab === 'reports' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              <FiAlertTriangle size={14} />
              Reported Conversations
              <span
                style={{
                  background: activeTab === 'reports' ? '#2C2118' : '#E9DAC4',
                  color: activeTab === 'reports' ? '#FFF' : TEXT,
                  fontSize: 10.5,
                  fontWeight: 800,
                  padding: '1px 6px',
                  borderRadius: 999,
                }}
              >
                {rCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('guidelines')}
              style={{
                padding: '8px 14px',
                borderRadius: 8,
                border: 'none',
                background: activeTab === 'guidelines' ? 'var(--grad, linear-gradient(180deg, #F2D892, #D7A646))' : 'transparent',
                color: activeTab === 'guidelines' ? '#2C2118' : MUTED,
                fontWeight: activeTab === 'guidelines' ? 800 : 600,
                fontSize: 12.5,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: activeTab === 'guidelines' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              <FiInfo size={14} />
              Verification Standards
            </button>
          </div>

          {activeTab !== 'guidelines' && (
            <div style={{ position: 'relative', width: 260, maxWidth: '100%' }}>
              <FiSearch
                size={13}
                style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: MUTED }}
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={activeTab === 'verifications' ? 'Search by technician or slug…' : 'Search by reporter or tech…'}
                style={{
                  height: 32,
                  width: '100%',
                  padding: '0 10px 0 28px',
                  border: `1px solid ${LINE}`,
                  borderRadius: 8,
                  fontSize: 12,
                  background: '#FFFDF8',
                  outline: 'none',
                }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    border: 'none',
                    background: 'none',
                    color: MUTED,
                    cursor: 'pointer',
                    fontSize: 11,
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          )}
        </div>

        {/* Tab Content */}
        <div style={{ padding: 20 }}>
          {/* TAB 1: Verification Requests */}
          {activeTab === 'verifications' && (
            <div>
              {loading && verifications == null ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {[1, 2].map((i) => (
                    <div key={i} style={{ height: 90, background: '#F5EFE4', borderRadius: 12, opacity: 0.6 }} />
                  ))}
                </div>
              ) : filteredVerifications.length === 0 ? (
                /* Luxury Empty State */
                <div
                  style={{
                    padding: '48px 24px',
                    textAlign: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, rgba(242, 216, 146, 0.4), rgba(215, 166, 70, 0.2))',
                      border: '1px solid #E2C686',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--g7, #A96F22)',
                      fontSize: 28,
                    }}
                  >
                    <FiAward />
                  </div>
                  <div>
                    <h3 style={{ fontFamily: "'Playfair Display', serif", fontSize: 18, fontWeight: 700, color: TEXT, margin: 0 }}>
                      {search ? 'No Matching Verification Requests' : 'All Verification Requests Reviewed'}
                    </h3>
                    <p style={{ fontSize: 13, color: MUTED, marginTop: 6, maxWidth: 520, lineHeight: 1.5, margin: '6px auto 0' }}>
                      {search
                        ? `No pending technician requests match "${search}". Try clearing the search query.`
                        : 'There are currently no technician profile verification requests awaiting moderation. When technicians request verification from their tech app, they will appear here for review.'}
                    </p>
                  </div>

                  {/* Standards Checklist preview */}
                  <div
                    style={{
                      marginTop: 18,
                      background: '#FFFDF8',
                      border: `1px solid ${LINE}`,
                      borderRadius: 12,
                      padding: '14px 20px',
                      maxWidth: 620,
                      width: '100%',
                      textAlign: 'left',
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                      gap: 10,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: TEXT }}>
                      <span style={{ color: '#3E8F57' }}>✓</span>
                      <span>Verified Badge Criteria: 4.5+ star rating</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: TEXT }}>
                      <span style={{ color: '#3E8F57' }}>✓</span>
                      <span>Minimum 10 completed salon services</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: TEXT }}>
                      <span style={{ color: '#3E8F57' }}>✓</span>
                      <span>Nail art portfolio showcase (5+ photos)</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: TEXT }}>
                      <span style={{ color: '#3E8F57' }}>✓</span>
                      <span>Identity & salon branch affiliation active</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {filteredVerifications.map((v) => (
                    <div
                      key={v.profileId}
                      style={{
                        background: '#FFFDF8',
                        border: `1px solid ${LINE}`,
                        borderRadius: 14,
                        padding: 16,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: 16,
                        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = 'var(--g7, #A96F22)';
                        e.currentTarget.style.boxShadow = '0 4px 16px rgba(169, 111, 34, 0.08)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = LINE;
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    >
                      {/* Tech Info */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 260, flex: 1 }}>
                        <div
                          style={{
                            width: 46,
                            height: 46,
                            borderRadius: '50%',
                            background: 'linear-gradient(135deg, #F2D892, #D7A646)',
                            border: '2px solid #C9933B',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 800,
                            fontSize: 16,
                            color: '#2C2118',
                            flexShrink: 0,
                            overflow: 'hidden',
                          }}
                        >
                          {v.avatarUrl ? (
                            <img src={v.avatarUrl} alt={v.displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            v.displayName.slice(0, 2).toUpperCase()
                          )}
                        </div>

                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontWeight: 800, fontSize: 14.5, color: TEXT }}>
                              {v.displayName}
                            </span>
                            <span
                              style={{
                                fontSize: 11.5,
                                color: 'var(--g7, #A96F22)',
                                fontWeight: 600,
                                background: 'rgba(169, 111, 34, 0.1)',
                                padding: '1px 6px',
                                borderRadius: 6,
                              }}
                            >
                              /{v.publicSlug}
                            </span>
                          </div>

                          {/* Stats Chips */}
                          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 4, fontSize: 12 }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#C08A2E', fontWeight: 700 }}>
                              <FiStar size={12} fill="#C08A2E" /> {v.rating.toFixed(1)}
                              <span style={{ color: MUTED, fontWeight: 500 }}>({v.reviewCount} reviews)</span>
                            </span>
                            <span style={{ color: LINE }}>•</span>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: TEXT, fontWeight: 500 }}>
                              <FiCheckCircle size={12} style={{ color: '#3E8F57' }} /> {v.completedServices} verified services
                            </span>
                            <span style={{ color: LINE }}>•</span>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: TEXT, fontWeight: 500 }}>
                              <FiImage size={12} style={{ color: '#3C7FB6' }} /> {v.portfolioCount} photos
                            </span>
                            <span style={{ color: LINE }}>•</span>
                            <span style={{ color: MUTED, fontSize: 11.5 }}>
                              Requested {timeAgo(v.requestedAt)} ({fmtDate(v.requestedAt)})
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button
                          type="button"
                          className="btn"
                          disabled={busy === `verify-${v.profileId}`}
                          onClick={() => handleVerify(v)}
                          style={{
                            minHeight: 34,
                            padding: '0 14px',
                            fontWeight: 700,
                            fontSize: 12,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                          }}
                        >
                          <FiCheck size={13} />
                          {busy === `verify-${v.profileId}` ? 'Verifying…' : 'Approve & Verify'}
                        </button>

                        <button
                          type="button"
                          className="btn ghost"
                          disabled={busy === `reject-${v.profileId}`}
                          onClick={() => {
                            setRejectTarget(v);
                            setRejectNote('');
                          }}
                          style={{
                            minHeight: 34,
                            padding: '0 12px',
                            fontSize: 12,
                            color: '#B85B4D',
                            borderColor: '#F0C9C2',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                          }}
                        >
                          <FiX size={13} />
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: Reported Conversations */}
          {activeTab === 'reports' && (
            <div>
              {loading && reports == null ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {[1, 2].map((i) => (
                    <div key={i} style={{ height: 90, background: '#F5EFE4', borderRadius: 12, opacity: 0.6 }} />
                  ))}
                </div>
              ) : filteredReports.length === 0 ? (
                /* Luxury Empty State */
                <div
                  style={{
                    padding: '48px 24px',
                    textAlign: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, rgba(62, 143, 87, 0.3), rgba(62, 143, 87, 0.1))',
                      border: '1px solid rgba(62, 143, 87, 0.35)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#3E8F57',
                      fontSize: 28,
                    }}
                  >
                    <FiShield />
                  </div>
                  <div>
                    <h3 style={{ fontFamily: "'Playfair Display', serif", fontSize: 18, fontWeight: 700, color: TEXT, margin: 0 }}>
                      {search ? 'No Matching Reports' : 'No Open Abuse Reports'}
                    </h3>
                    <p style={{ fontSize: 13, color: MUTED, marginTop: 6, maxWidth: 520, lineHeight: 1.5, margin: '6px auto 0' }}>
                      {search
                        ? `No open reports match "${search}". Try clearing the search query.`
                        : 'There are currently no reported direct message threads or abusive conversations flagged on the platform. All client-technician messaging channels are operating normally.'}
                    </p>
                  </div>

                  <div
                    style={{
                      marginTop: 18,
                      background: '#FFFDF8',
                      border: `1px solid ${LINE}`,
                      borderRadius: 12,
                      padding: '14px 20px',
                      maxWidth: 620,
                      width: '100%',
                      textAlign: 'left',
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                      gap: 10,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: TEXT }}>
                      <span style={{ color: '#3E8F57' }}>✓</span>
                      <span>Zero-tolerance harassment policy active</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: TEXT }}>
                      <span style={{ color: '#3E8F57' }}>✓</span>
                      <span>Automatic content & keyword filtering</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: TEXT }}>
                      <span style={{ color: '#3E8F57' }}>✓</span>
                      <span>Instant thread blocking & moderation</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: TEXT }}>
                      <span style={{ color: '#3E8F57' }}>✓</span>
                      <span>Full audit trail for compliance</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {filteredReports.map((r) => (
                    <div
                      key={r.reportId}
                      style={{
                        background: '#FFFDF8',
                        border: '1px solid #F0C9C2',
                        borderRadius: 14,
                        padding: 16,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: 16,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 260, flex: 1 }}>
                        <div
                          style={{
                            width: 38,
                            height: 38,
                            borderRadius: '50%',
                            background: 'rgba(184, 91, 77, 0.12)',
                            border: '1px solid rgba(184, 91, 77, 0.25)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#B85B4D',
                            flexShrink: 0,
                          }}
                        >
                          <FiAlertTriangle size={18} />
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontWeight: 800, fontSize: 14, color: TEXT }}>
                              Report by {r.reportedBy}
                            </span>
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                background: '#FBEFE9',
                                color: '#B85B4D',
                                padding: '2px 8px',
                                borderRadius: 6,
                              }}
                            >
                              Flagged Conversation
                            </span>
                          </div>
                          <div style={{ fontSize: 12.5, color: TEXT, marginTop: 3 }}>
                            Technician: <strong>{r.technicianName || '—'}</strong>
                            {r.technicianSlug ? <span style={{ color: MUTED }}> (/{r.technicianSlug})</span> : null}
                          </div>
                          <div style={{ fontSize: 12, color: '#B85B4D', fontWeight: 600, marginTop: 4 }}>
                            Reason: {r.reason || 'No reason specified'}
                          </div>
                          <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>
                            Thread status: <strong>{r.threadStatus || 'active'}</strong> • Submitted {timeAgo(r.createdAt)} ({fmtDate(r.createdAt)})
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button
                          type="button"
                          className="btn ghost"
                          disabled={busy === `dismiss-${r.reportId}`}
                          onClick={() => handleDismissReport(r)}
                          style={{ minHeight: 34, fontSize: 12 }}
                        >
                          Dismiss Report
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={busy === `block-${r.reportId}`}
                          onClick={() => setBlockTarget(r)}
                          style={{
                            minHeight: 34,
                            background: '#B85B4D',
                            color: '#fff',
                            border: '1px solid #A14E42',
                            fontSize: 12,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                          }}
                        >
                          <FiSlash size={13} />
                          Block Conversation
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: Guidelines & Standards */}
          {activeTab === 'guidelines' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
              <div style={{ ...cardStyle, padding: 18, background: '#FFFDF8' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ color: 'var(--g7, #A96F22)', fontSize: 18 }}><FiAward /></span>
                  <h4 style={{ fontFamily: "'Playfair Display', serif", fontSize: 15, fontWeight: 700, margin: 0, color: TEXT }}>
                    1. Verified Badge Eligibility
                  </h4>
                </div>
                <p style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.5 }}>
                  The Verified Technician badge signals mastery, authentic salon affiliation, and positive client outcomes. Super Admins verify that the technician is an active staff member in good standing with zero open conduct flags.
                </p>
              </div>

              <div style={{ ...cardStyle, padding: 18, background: '#FFFDF8' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ color: '#C08A2E', fontSize: 18 }}><FiStar /></span>
                  <h4 style={{ fontFamily: "'Playfair Display', serif", fontSize: 15, fontWeight: 700, margin: 0, color: TEXT }}>
                    2. Service & Review Thresholds
                  </h4>
                </div>
                <p style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.5 }}>
                  Technicians must achieve a minimum rating of 4.5★ across at least 5 verified customer appointments. Profiles with low volume or recent disputed transactions should be held for further review.
                </p>
              </div>

              <div style={{ ...cardStyle, padding: 18, background: '#FFFDF8' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ color: '#3C7FB6', fontSize: 18 }}><FiImage /></span>
                  <h4 style={{ fontFamily: "'Playfair Display', serif", fontSize: 15, fontWeight: 700, margin: 0, color: TEXT }}>
                    3. Showcase Portfolio Standards
                  </h4>
                </div>
                <p style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.5 }}>
                  All portfolio pictures must showcase genuine nail artistry performed by the technician. Stock images, inappropriate pictures, or copyrighted marketing assets will result in rejection.
                </p>
              </div>

              <div style={{ ...cardStyle, padding: 18, background: '#FFFDF8' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ color: '#B85B4D', fontSize: 18 }}><FiShield /></span>
                  <h4 style={{ fontFamily: "'Playfair Display', serif", fontSize: 15, fontWeight: 700, margin: 0, color: TEXT }}>
                    4. DM Safety & Content Moderation
                  </h4>
                </div>
                <p style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.5 }}>
                  Direct messages between clients and technicians are strictly for appointment coordination and consultation. Any abusive behavior, harassment, or solicitation outside the platform should be immediately blocked.
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* MODAL: Reject Verification Request */}
      {rejectTarget && (
        <div
          role="dialog"
          aria-label="Reject Verification"
          onClick={() => setRejectTarget(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(20,16,10,.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 60,
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              ...cardStyle,
              background: '#FFFDF8',
              padding: 22,
              width: 460,
              maxWidth: '92vw',
              boxShadow: '0 24px 70px rgba(0,0,0,0.35)',
            }}
          >
            <div style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, fontSize: 17, marginBottom: 6, color: TEXT }}>
              Reject Verification Request
            </div>
            <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.5, marginBottom: 14 }}>
              Are you sure you want to reject the verification request for <strong>{rejectTarget.displayName}</strong>? You may provide a reason that will be logged in their moderation record.
            </div>

            <label style={{ fontSize: 11.5, color: '#5C5240', fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Reason for rejection (optional)
              <textarea
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder="e.g. Portfolio does not meet minimum quality requirements or insufficient completed appointments."
                rows={3}
                style={{
                  width: '100%',
                  marginTop: 4,
                  borderRadius: 8,
                  border: `1px solid ${LINE}`,
                  padding: 8,
                  fontFamily: 'inherit',
                  fontSize: 12.5,
                  background: '#fff',
                  resize: 'vertical',
                }}
              />
            </label>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setRejectTarget(null)}
                style={{ minHeight: 34 }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                onClick={handleConfirmReject}
                style={{ minHeight: 34, background: '#B85B4D', color: '#fff', borderColor: '#A14E42' }}
              >
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Block Conversation Thread */}
      {blockTarget && (
        <div
          role="dialog"
          aria-label="Block Conversation"
          onClick={() => setBlockTarget(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(20,16,10,.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 60,
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              ...cardStyle,
              background: '#FFFDF8',
              padding: 22,
              width: 460,
              maxWidth: '92vw',
              boxShadow: '0 24px 70px rgba(0,0,0,0.35)',
            }}
          >
            <div style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, fontSize: 17, marginBottom: 6, color: '#B85B4D' }}>
              Block Conversation Thread
            </div>
            <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.5, marginBottom: 14 }}>
              This will immediately block and terminate the reported conversation between <strong>{blockTarget.reportedBy}</strong> and technician <strong>{blockTarget.technicianName || 'specified'}</strong>. Neither party will be able to exchange further messages in this thread.
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setBlockTarget(null)}
                style={{ minHeight: 34 }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                onClick={handleConfirmBlock}
                style={{ minHeight: 34, background: '#B85B4D', color: '#fff', borderColor: '#A14E42' }}
              >
                Block Thread
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
