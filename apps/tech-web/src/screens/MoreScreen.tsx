import { useCallback, useEffect, useState } from 'react';
import { techApi, type TechMoreState, type TechSkillsView } from '../api/techApi';
import { useAuth } from '../auth/AuthContext';
import { useTechNav } from '../shell/nav';
import { statusLabel, statusKind } from '../lib/tech';

// Module 6 — Profile / More. Identity comes from GET /tech/more/state (server-scoped). Rows that have a backing
// endpoint act on it; rows without one yet show an honest message rather than a dead tap or fabricated data.
const Chev = () => (<svg className="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>);

import { useEscapeKey } from '@aipowersalon/ui';
import { FiUser, FiBriefcase, FiClock, FiStar, FiCheckCircle, FiRefreshCw, FiFileText, FiTrendingUp, FiDollarSign, FiCreditCard, FiTag, FiMessageCircle, FiBell, FiPackage, FiHelpCircle, FiShield, FiFile, FiAlertTriangle, FiSettings } from 'react-icons/fi';
export function MoreScreen() {
  const nav = useTechNav();
  const { logout } = useAuth();
  const [m, setM] = useState<TechMoreState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [skills, setSkills] = useState<TechSkillsView | null>(null);
  useEscapeKey(confirm || !!skills, () => { setConfirm(false); setSkills(null); });
  const [skillSel, setSkillSel] = useState('');
  const [skillProficiency, setSkillProficiency] = useState('intermediate');
  const [skillExperience, setSkillExperience] = useState<string>('');
  const [skillNote, setSkillNote] = useState('');
  const [skillPhotos, setSkillPhotos] = useState<File[]>([]);
  const [skillCert, setSkillCert] = useState<File | null>(null);
  const [skillPhotosUrl, setSkillPhotosUrl] = useState<string[]>([]);
  const [skillCertUrl, setSkillCertUrl] = useState<string | null>(null);
  const [skillEditId, setSkillEditId] = useState<string | null>(null);
  const [skillBusy, setSkillBusy] = useState(false);
  const [skillMsg, setSkillMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    techApi.more().then((r) => { setM(r); setError(null); }).catch((e: any) => setError(e?.message || 'Failed to load your profile.'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const soon = (label: string) => setNote(`${label} isn’t available in the app yet — contact the front desk if you need it now.`);
  const fmtT = (t: string | null) => { if (!t) return ''; const [h, mm] = t.split(':'); let hh = Number(h); const ap = hh < 12 ? 'AM' : 'PM'; hh = hh % 12 || 12; return `${hh}:${mm} ${ap}`; };
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const showHours = useCallback(async () => {
    try {
      const days = await techApi.workingHours();
      const working = days.filter((d) => d.isWorking && d.startTime && d.endTime);
      setNote(working.length ? working.map((d) => `${DOW[d.dayOfWeek] ?? '?'} ${fmtT(d.startTime)}–${fmtT(d.endTime)}`).join(' · ') : 'No working hours are set yet — contact the front desk.');
    } catch { setNote('Couldn’t load working hours right now.'); }
  }, []);
  const openSkills = useCallback(async () => {
    setSkillMsg(null); setSkillSel(''); setSkillEditId(null); setSkillNote(''); setSkillExperience(''); setSkillProficiency('intermediate'); setSkillPhotos([]); setSkillCert(null); setSkillPhotosUrl([]); setSkillCertUrl(null);
    try { setSkills(await techApi.skills()); } catch { setNote('Couldn’t load skills right now.'); }
  }, []);

  const handleEditDraft = (req: any) => {
    setSkillEditId(req.id);
    setSkillSel(req.serviceId);
    setSkillProficiency(req.proficiencyLevel || 'intermediate');
    setSkillExperience(req.experienceYears ? req.experienceYears.toString() : '');
    setSkillNote(req.note || '');
    setSkillPhotosUrl(req.supportingPhotos || []);
    setSkillCertUrl(req.certificateEvidence || null);
    setSkillPhotos([]);
    setSkillCert(null);
    setSkillMsg(null);
  };

  const submitSkill = useCallback(async (isDraft: boolean) => {
    if (!skillSel) return;
    setSkillBusy(true); setSkillMsg(null);
    try {
      let photoUrls = [...skillPhotosUrl];
      if (skillPhotos.length > 0) {
        const uploads = await Promise.all(skillPhotos.map(f => techApi.uploadSkillDocument(f)));
        photoUrls = uploads.map(u => u.url);
      }
      
      let certUrl = skillCertUrl;
      if (skillCert) {
        const certUpload = await techApi.uploadSkillDocument(skillCert);
        certUrl = certUpload.url;
      }

      const body = {
        serviceId: skillSel,
        proficiencyLevel: skillProficiency,
        experienceYears: skillExperience ? parseInt(skillExperience, 10) : undefined,
        supportingPhotos: photoUrls,
        certificateEvidence: certUrl || undefined,
        note: skillNote || undefined,
        status: (isDraft ? 'draft' : 'submitted') as any
      };
      if (skillEditId) {
        await techApi.updateSkillChange(skillEditId, body);
      } else {
        await techApi.requestSkillChange(body);
      }
      setSkills(await techApi.skills());
      setSkillSel(''); setSkillEditId(null); setSkillNote(''); setSkillExperience(''); setSkillProficiency('intermediate'); setSkillPhotos([]); setSkillCert(null); setSkillPhotosUrl([]); setSkillCertUrl(null);
      setSkillMsg(isDraft ? 'Draft saved.' : 'Request submitted — your manager will review it.');
      setTimeout(() => setSkillMsg(null), 5000);
    } catch (e: any) { setSkillMsg(e?.message || 'Couldn’t send the request.'); }
    finally { setSkillBusy(false); }
  }, [skillSel, skillProficiency, skillExperience, skillNote, skillEditId, skillPhotos, skillCert, skillPhotosUrl, skillCertUrl]);

  const t = m?.technician;

  const sections = [
    {
      title: 'Profile',
      description: 'Manage your profile and workplaces',
      rows: [
        {
          label: 'My Profile',
          icon: <FiUser />,
          onClick: () => nav.openProfile(),
        },
        {
          label: 'My Salons',
          icon: <FiBriefcase />,
          onClick: () => nav.openWorkplaces(),
        },
        {
          label: 'Settings',
          icon: <FiSettings />,
          onClick: () => nav.openSettings(),
        },
      ],
    },

    {
      title: 'Work & Schedule',
      description: 'Your schedule, services and daily work',
      rows: [
        {
          label: 'Working Hours',
          icon: <FiClock />,
          value: m?.workingHoursLabel ?? '—',
          onClick: showHours,
        },
        {
          label: 'Specialties / Skills',
          icon: <FiStar />,
          value: m?.skillsLabel ?? '—',
          onClick: openSkills,
        },
        {
          label: "Today's Follow-Ups",
          icon: <FiCheckCircle />,
          onClick: () => nav.openFollowUps(),
        },
        {
          label: 'Queue / Turn',
          icon: <FiRefreshCw />,
          onClick: () => nav.openQueue(),
        },
        {
          label: 'Service History',
          icon: <FiFileText />,
          onClick: () => nav.openServiceHistory(),
        },
        {
          label: 'Performance',
          icon: <FiTrendingUp />,
          onClick: () => soon('Performance'),
        },
      ],
    },

    {
      title: 'Money & Business',
      description: 'Earnings, payouts and business activity',
      rows: [
        {
          label: 'End-of-Day Cash',
          icon: <FiDollarSign />,
          onClick: () => nav.openCashHandoff(),
        },
        {
          label: 'Payroll & Payouts',
          icon: <FiCreditCard />,
          onClick: () => nav.openPayroll(),
        },
        {
          label: 'My Deals',
          icon: <FiTag />,
          onClick: () => nav.openMyDeals(),
        },
      ],
    },

    {
      title: 'Communication',
      description: 'Stay connected and up to date',
      rows: [
        {
          label: 'Messages',
          icon: <FiMessageCircle />,
          onClick: () => nav.openMessages(),
        },
        {
          label: 'Notifications',
          icon: <FiBell />,
          onClick: () => nav.openNotifications(),
        },
      ],
    },

    {
      title: 'Tools',
      description: 'Additional tools for your work',
      rows: [
        {
          label: 'Report a Product',
          icon: <FiPackage />,
          onClick: () => nav.openReportProduct(),
        },
      ],
    },

    {
      title: 'Support',
      description: 'Need help? We’re here.',
      rows: [
        {
          label: 'Help & Support',
          icon: <FiHelpCircle />,
          onClick: () => nav.openHelp(),
        },
      ],
    },

    {
      title: 'Legal & Account',
      description: 'Privacy and account management',
      rows: [
        {
          label: 'Privacy Policy',
          icon: <FiShield />,
          onClick: () => nav.openPrivacy(),
        },
        {
          label: 'Terms of Service',
          icon: <FiFile />,
          onClick: () => nav.openTerms(),
        },
        {
          label: 'Account Deactivation',
          icon: <FiAlertTriangle />,
          onClick: () => nav.openDeleteAccount(),
        },
      ],
    },
  ];
  return (
    <div>
      <div className="tech-tab-header" style={{ marginBottom: 32 }}>
        <div className="tech-tab-header__inner">
          <div className="t-title">More</div>
        </div>
      </div>
      <div className="tech-main-2">
        {error ? <div className="tech-state" role="alert" style={{ color: 'var(--tech-danger)' }}>{error}</div> : null}
        {note ? <div className="tech-card" style={{ marginBottom: 12, padding: 12, fontSize: 13 }} role="status">{note}</div> : null}

        {!m ? (
          <div className="tech-card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div className="tech-skel" style={{ width: 64, height: 64, borderRadius: 99, flex: '0 0 auto' }} />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center' }}>
              <div className="tech-skel" style={{ width: 140, height: 22 }} />
              <div className="tech-skel" style={{ width: 100, height: 16 }} />
              <div className="tech-skel" style={{ width: 80, height: 24, borderRadius: 12, marginTop: 4 }} />
            </div>
          </div>
        ) : (
          <div className="tech-card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div className="tech-avatar lg">{t?.avatarUrl ? <img src={t.avatarUrl} alt="" /> : (t?.initials || '?')}</div>
            <div>
              <div className="tech-h-serif" style={{ fontSize: 19, fontWeight: 700 }}>{t?.fullName || 'Technician'}</div>
              <div className="tech-label">{t?.roleLabel || 'Technician'}</div>
              {t ? <span className={'tech-chip ' + statusKind(t.status)} style={{ marginTop: 6 }}>{statusLabel(t.status)}</span> : null}
            </div>
          </div>
        )}

        <div className="tech-section-title" style={{ margin: '14px 0 8px' }}>Quick Controls</div>
        <div className="tech-qa" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 14 }}>
          <button onClick={async () => { try { const r = await techApi.toggleBreak(); setNote(r.status === 'on_break' ? 'Break started.' : 'Break ended — you are back in rotation.'); load(); } catch (e: any) { setNote(e?.message || 'Could not toggle break.'); } }}><span className="ic">☕</span>Break Mode</button>
          <button onClick={() => nav.openQueue()}><span className="ic">🔄</span>Queue / Turn</button>
          <button onClick={showHours}><span className="ic">🕘</span>Work Hours</button>
        </div>

        {sections.map((sec) => (
          <section className="more-section" key={sec.title}>
            <div className="more-section-header">
              <div>
                <div className="more-section-title">
                  {sec.title}
                </div>

                {sec.description ? (
                  <div className="more-section-description">
                    {sec.description}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="tech-card more-menu-card">
              {sec.rows.map((r) => (
                <button
                  key={r.label}
                  className="more-menu-row"
                  onClick={r.onClick}
                >
                  <span className="more-menu-icon">
                    {r.icon}
                  </span>

                  <span className="more-menu-content">
                    <span className="more-menu-label">
                      {r.label}
                    </span>

                    {r.value != null ? (
                      <span className="more-menu-value">
                        {r.value}
                      </span>
                    ) : null}
                  </span>

                  <Chev />
                </button>
              ))}
            </div>
          </section>
        ))}
        <button className="tech-btn danger-outline" style={{ marginTop: 14 }} onClick={() => setConfirm(true)}>Log Out</button>

        {confirm ? (
          <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, background: 'rgba(20,12,4,0.4)', padding: 10, display: 'grid', placeItems: 'center', zIndex: 20 }} onClick={() => setConfirm(false)}>
            <div className="tech-card" style={{ width: '100%', maxWidth: 480, borderRadius: '8px ', margin: 0, paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }} onClick={(e) => e.stopPropagation()}>
              <div className="tech-section-title" style={{ marginBottom: 8 }}>Log out?</div>
              <div className="tech-muted" style={{ fontSize: 13, marginBottom: 12 }}>You’ll need to sign in again to access your schedule and tickets.</div>
              <button className="tech-btn danger-outline" onClick={() => logout()}>Log Out</button>
              <button className="tech-btn outline" style={{ marginTop: 8 }} onClick={() => setConfirm(false)}>Cancel</button>
            </div>
          </div>
        ) : null}
        {/* nmnm */}
        {skills ? (
          <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, padding: 16, background: 'rgba(44, 33, 24, 0.6)', backdropFilter: 'blur(4px)', display: 'grid', placeItems: 'center', zIndex: 100 }} onClick={() => setSkills(null)}>
            <div className="tech-card" style={{ width: '100%', maxWidth: 500, borderRadius: 16, margin: 0, padding: '24px 20px calc(24px + env(safe-area-inset-bottom))', maxHeight: '85vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 24, position: 'relative', boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--tech-border)', paddingBottom: 16, margin: '-4px -4px 0' }}>
                <h3 style={{ margin: 0, fontSize: 22, color: 'var(--tech-text)' }}>Specialties &amp; Skills</h3>
                <button onClick={() => setSkills(null)} style={{ background: 'var(--tech-surface-soft)', border: '1px solid var(--tech-border)', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tech-text-secondary)', cursor: 'pointer' }}>✕</button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--tech-text-secondary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Specialties</div>
                  {skills.specialties.length ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {skills.specialties.map((sp) => <span key={sp} className="tech-chip" style={{ background: 'var(--tech-primary-light)', color: 'var(--tech-primary-dark)', padding: '6px 12px', fontSize: 13, fontWeight: 500 }}>{sp}</span>)}
                    </div>
                  ) : <p style={{ fontSize: 14, color: 'var(--tech-text-muted)', margin: 0, fontStyle: 'italic' }}>No specialties assigned yet.</p>}
                </div>

                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--tech-text-secondary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Eligible Services ({skills.services.length})</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {skills.services.map((sv) => (
                      <div key={sv.serviceId} style={{ background: 'var(--tech-surface-soft)', border: '1px solid var(--tech-border)', borderRadius: 8, padding: '8px 12px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--tech-text)' }}>
                        {sv.serviceName}
                        {sv.isPrimary && <FiStar size={14} style={{ color: 'var(--tech-primary)' }} />}
                      </div>
                    ))}
                  </div>
                </div>

                {skills.requests.length > 0 ? (
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--tech-text-secondary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Your Requests</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {skills.requests.map((q) => (
                        <div key={q.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 14, border: '1px solid var(--tech-border)', borderRadius: 12, background: 'var(--tech-surface-soft)' }}>
                          <div style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
                            <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--tech-text)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ color: q.requestType === 'add' ? 'var(--tech-success)' : 'var(--tech-danger)' }}>
                                {q.requestType === 'add' ? '+' : '\u2212'}
                              </span>
                              {q.serviceName}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span className={`tech-chip ${statusKind(q.status as any)}`} style={{ textTransform: 'capitalize', padding: '2px 8px', fontSize: 11 }}>{q.status.replace(/_/g, ' ')}</span>
                            </div>
                            {q.reviewNotes && <div style={{ fontSize: 13, color: 'var(--tech-danger)', marginTop: 6, background: 'var(--tech-danger-bg)', padding: '6px 10px', borderRadius: 6 }}>Notes: {q.reviewNotes}</div>}
                          </div>
                          {(q.status === 'draft' || q.status === 'more_information_required') && (
                            <button onClick={() => handleEditDraft(q)} style={{ background: 'var(--tech-surface)', border: '1px solid var(--tech-border)', borderRadius: 8, padding: '6px 12px', fontSize: 13, fontWeight: 500, color: 'var(--tech-text)', cursor: 'pointer' }}>Edit</button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div style={{ background: 'var(--tech-surface-soft)', borderRadius: 12, border: '1px solid var(--tech-border)', padding: 16, marginTop: 8 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--tech-text)', marginBottom: 16 }}>
                    {skillEditId ? 'Edit Skill Request' : 'Request a New Skill'}
                  </div>
                  {skills.requestableServices.length || skillEditId ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {!skillEditId ? (
                        <div>
                          <select value={skillSel} onChange={(e) => setSkillSel(e.target.value)} style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--tech-border)', background: 'var(--tech-surface)', color: 'var(--tech-text)', fontSize: 14, outline: 'none' }}>
                            <option value="">Select a service…</option>
                            {skills.requestableServices.map((rs) => <option key={rs.serviceId} value={rs.serviceId}>{rs.serviceName}{rs.category ? ` (${rs.category})` : ''}</option>)}
                          </select>
                        </div>
                      ) : (
                        <div style={{ fontWeight: 500, fontSize: 14, color: 'var(--tech-primary)' }}>Editing request for: {skills.requests.find(r => r.id === skillEditId)?.serviceName}</div>
                      )}

                      {skillSel && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                          <div className="your-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                            <div>
                              <div style={{ fontSize: 12, marginBottom: 6, fontWeight: 600, color: 'var(--tech-text-secondary)' }}>Proficiency Level</div>
                              <select value={skillProficiency} onChange={(e) => setSkillProficiency(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--tech-border)', background: 'var(--tech-surface)', color: 'var(--tech-text)', fontSize: 14, outline: 'none' }}>
                                <option value="beginner">Beginner</option>
                                <option value="intermediate">Intermediate</option>
                                <option value="advanced">Advanced</option>
                                <option value="expert">Expert</option>
                              </select>
                            </div>
                            <div>
                              <div style={{ fontSize: 12, marginBottom: 6, fontWeight: 600, color: 'var(--tech-text-secondary)' }}>Years of Exp. (optional)</div>
                              <input type="number" value={skillExperience} onChange={(e) => setSkillExperience(e.target.value)} placeholder="e.g. 2" style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--tech-border)', background: 'var(--tech-surface)', color: 'var(--tech-text)', fontSize: 14, outline: 'none' }} />
                            </div>
                          </div>

                          <div>
                            <div style={{ fontSize: 12, marginBottom: 6, fontWeight: 600, color: 'var(--tech-text-secondary)' }}>Notes / Message to Manager</div>
                            <textarea value={skillNote} onChange={(e) => setSkillNote(e.target.value)} placeholder="Additional info..." style={{ width: '100%', padding: '12px 14px', borderRadius: 8, border: '1px solid var(--tech-border)', background: 'var(--tech-surface)', color: 'var(--tech-text)', fontSize: 14, resize: 'none', height: 80, outline: 'none' }} />
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, background: 'var(--tech-surface)', padding: 16, borderRadius: 12, border: '1px solid var(--tech-border)' }}>
                            {/* Supporting Photos */}
                            <div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--tech-text)' }}>Supporting Photos</div>
                                <label style={{ cursor: 'pointer', fontSize: 12, color: 'var(--tech-primary)', fontWeight: 600 }}>
                                  + Add Photos
                                  <input type="file" multiple accept="image/*" onChange={(e) => setSkillPhotos([...skillPhotos, ...Array.from(e.target.files || [])])} style={{ display: 'none' }} />
                                </label>
                              </div>
                              
                              {skillPhotos.length > 0 || skillPhotosUrl.length > 0 ? (
                                <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
                                  {skillPhotosUrl.map((url, i) => (
                                    <div key={`url-${i}`} style={{ position: 'relative', flexShrink: 0 }}>
                                      <img src={url} alt="Current" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--tech-border)' }} />
                                    </div>
                                  ))}
                                  {skillPhotos.map((file, i) => (
                                    <div key={`file-${i}`} style={{ position: 'relative', flexShrink: 0 }}>
                                      <img src={URL.createObjectURL(file)} alt="Preview" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--tech-border)' }} />
                                      <div 
                                        onClick={() => setSkillPhotos(skillPhotos.filter((_, idx) => idx !== i))}
                                        style={{ position: 'absolute', top: -6, right: -6, background: '#fff', border: '1px solid #ccc', borderRadius: '50%', width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, cursor: 'pointer', color: '#ff3b30' }}
                                      >✕</div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div style={{ fontSize: 12, color: 'var(--tech-text-secondary)', fontStyle: 'italic' }}>No photos added.</div>
                              )}
                            </div>

                            <div style={{ borderTop: '1px solid var(--tech-border)' }} />

                            {/* Certificate */}
                            <div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--tech-text)' }}>Certificate / Evidence</div>
                                {!skillCert && !skillCertUrl && (
                                  <label style={{ cursor: 'pointer', fontSize: 12, color: 'var(--tech-primary)', fontWeight: 600 }}>
                                    + Add PDF/Image
                                    <input type="file" accept="image/*,.pdf" onChange={(e) => setSkillCert(e.target.files?.[0] || null)} style={{ display: 'none' }} />
                                  </label>
                                )}
                              </div>
                              
                              {skillCert ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--tech-background)', padding: 12, borderRadius: 8, border: '1px solid var(--tech-border)' }}>
                                  <div style={{ fontSize: 24 }}>{skillCert.name.toLowerCase().endsWith('.pdf') ? '📄' : '🖼️'}</div>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{skillCert.name}</div>
                                    <div style={{ fontSize: 11, color: 'var(--tech-text-secondary)' }}>Ready to upload</div>
                                  </div>
                                  <div onClick={() => setSkillCert(null)} style={{ fontSize: 12, color: '#ff3b30', fontWeight: 600, cursor: 'pointer', padding: '4px 8px' }}>Remove</div>
                                </div>
                              ) : skillCertUrl ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--tech-background)', padding: 12, borderRadius: 8, border: '1px solid var(--tech-border)' }}>
                                  <div style={{ fontSize: 24 }}>📄</div>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 600 }}>Current Document</div>
                                    <div style={{ fontSize: 11, color: 'var(--tech-primary)' }}>Attached to request</div>
                                  </div>
                                  <label style={{ fontSize: 12, color: 'var(--tech-primary)', fontWeight: 600, cursor: 'pointer' }}>
                                    Change
                                    <input type="file" accept="image/*,.pdf" onChange={(e) => setSkillCert(e.target.files?.[0] || null)} style={{ display: 'none' }} />
                                  </label>
                                </div>
                              ) : (
                                <div style={{ fontSize: 12, color: 'var(--tech-text-secondary)', fontStyle: 'italic' }}>No document added.</div>
                              )}
                            </div>
                          </div>

                          <div
                            style={{
                              display: 'flex',
                              gap: 10,
                              marginTop: 8,
                              flexWrap: 'wrap',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            <button className="tech-btn outline" disabled={skillBusy} onClick={() => submitSkill(true)} style={{ flex: 1, height: 40 }}>{skillBusy ? 'Saving…' : 'Save Draft'}</button>
                            <button className="tech-btn" disabled={skillBusy} onClick={() => submitSkill(false)} style={{ flex: 2, background: 'var(--tech-primary)', color: '#fff', border: 'none', height: 40 }}>{skillBusy ? 'Submitting…' : 'Submit Request'}</button>
                          </div>
                          {skillEditId && (
                            <button className="tech-btn outline" style={{ marginTop: 4, border: 'none', color: 'var(--tech-text-muted)', height: 40 }} onClick={() => { setSkillEditId(null); setSkillSel(''); setSkillMsg(null); }}>Cancel Edit</button>
                          )}
                        </div>
                      )}
                    </div>
                  ) : <p style={{ fontSize: 14, color: 'var(--tech-success)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><FiCheckCircle /> You’re already eligible for every active service.</p>}
                  {skillMsg ? <div style={{ fontSize: 13, marginTop: 16, padding: '10px 14px', background: 'var(--tech-primary-light)', color: 'var(--tech-primary-dark)', borderRadius: 8, fontWeight: 500 }} role="status">{skillMsg}</div> : null}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
