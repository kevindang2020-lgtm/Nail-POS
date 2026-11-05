// POSAIFrontDeskScreen.tsx — the AI Front Desk agent list + Create-Agent draft flow (spec Page 2 + the wireable core
// of the Create-Agent wizard). Real CRUD against /tenant/ai/receptionist/agents. Agents are config-only DRAFTS:
// there is no provider provisioning here (that needs a Retell account), so statuses honestly stay draft/paused/
// archived and a plain note explains that going live is a later, account-gated step. Champagne Gold via existing
// pos-web tokens.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { posAiApi, type ReceptionistAgent, type ProvisioningJob } from '../api/posAiApi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { growthCode } from './growthLabels';

const cardBox: React.CSSProperties = { background: '#FFFCF6', border: '1px solid var(--line)', borderRadius: 14, padding: 14 };
const headStyle: React.CSSProperties = { fontWeight: 800, fontSize: 13.5, marginBottom: 10, fontFamily: 'var(--aps-font-head, Playfair Display)' };
const GOLD = '#A96F22';
const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  draft: { bg: '#FBEEDD', fg: '#9B6B1E' }, ready: { bg: '#F0D4AB', fg: '#7A5518' }, live: { bg: '#EAF5EE', fg: '#3E8F57' },
  paused: { bg: '#F3ECE1', fg: '#6C6965' }, error: { bg: '#F7E4DA', fg: '#B4673B' }, archived: { bg: '#EFEAE1', fg: '#9B8B78' },
};
const FILTERS = ['all', 'draft', 'paused', 'archived'] as const;
const inputStyle: React.CSSProperties = { width: '100%', height: 34, padding: '0 10px', borderRadius: 8, border: '1px solid var(--line)', background: '#fff', fontSize: 13, fontFamily: 'inherit' };
const btnGold: React.CSSProperties = { height: 34, padding: '0 14px', borderRadius: 8, border: 'none', background: GOLD, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };

export function POSAIFrontDeskScreen() {
  const nav = useNavigate();
  const [agents, setAgents] = useState<ReceptionistAgent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', callType: 'inbound', language: 'en', useCase: '' });
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [job, setJob] = useState<ProvisioningJob | null>(null);

  const load = () => posAiApi.receptionistAgents().then(setAgents).catch((e: any) => setError(e?.message || tx('pos.failed_to_load_agents')));
  useEffect(() => { load(); }, []);

  // Poll an active provisioning job until it settles, then refresh the list.
  useEffect(() => {
    if (!job || job.status === 'succeeded' || job.status === 'failed') return;
    const t = setInterval(async () => {
      try { const next = await posAiApi.receptionistProvisioningJob(job.id); setJob(next); if (next.status === 'succeeded' || next.status === 'failed') { clearInterval(t); await load(); } }
      catch { clearInterval(t); }
    }, 1500);
    return () => clearInterval(t);
  }, [job]);

  const provision = async (id: string) => {
    setError(null);
    try { const j = await posAiApi.provisionReceptionistAgent(id); setJob(j); }
    catch (e: any) { setError(e?.message || tx('pos.could_not_start_provisioning')); }
  };

  const shown = useMemo(() => (agents ?? []).filter((a) => filter === 'all' || a.status === filter), [agents, filter]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: (agents ?? []).length };
    for (const a of agents ?? []) c[a.status] = (c[a.status] ?? 0) + 1;
    return c;
  }, [agents]);

  const submit = async () => {
    if (!form.name.trim()) { setFormErr(tx('growth.frontDesk.nameRequired')); return; }
    setBusy(true); setFormErr(null);
    try {
      await posAiApi.createReceptionistAgent({ name: form.name.trim(), callType: form.callType, language: form.language, useCase: form.useCase.trim() || undefined });
      setForm({ name: '', callType: 'inbound', language: 'en', useCase: '' });
      setCreating(false);
      await load();
    } catch (e: any) { setFormErr(e?.message || tx('pos.could_not_create_the_agent')); }
    finally { setBusy(false); }
  };

  const act = async (id: string, status: string) => { try { await posAiApi.setReceptionistAgentStatus(id, status); await load(); } catch (e: any) { setError(e?.message || tx('pos.action_failed')); } };

  if (error) return <div className="work"><div className="err">{error}</div></div>;
  if (!agents) return <div className="work"><div className="state">{tx('pos.loading_ai_front_desk_u2026')}</div></div>;

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="vh flex flex-col sm:flex-row gap-3 justify-between">
        <div>
        <div>
          <h1>{tx('pos.ai_front_desk')}</h1>
        <div className="sub mb-3">{tx('pos.design_how_your_ai_receptionist_answers_116h')}</div>
        </div>
        </div>
        <button className="btn w-fit whitespace-nowrap"  onClick={() => { setCreating((v) => !v); setFormErr(null); }}>{creating ? tx('pos.close') : tx('pos.create_agent')}</button>
      </div>

      {job && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(40,34,32,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => (job.status === 'succeeded' || job.status === 'failed') && setJob(null)}>
          <div style={{ ...cardBox, width: 420, maxWidth: '90vw' }} onClick={(e) => e.stopPropagation()}>
            <div style={headStyle}>{tx('pos.provisioning_agent')}</div>
            <div style={{ height: 8, background: '#EFE6D6', borderRadius: 4, marginBottom: 10 }}><div style={{ width: `${job.progress}%`, height: 8, background: job.status === 'failed' ? '#B4673B' : GOLD, borderRadius: 4, transition: 'width .3s' }} /></div>
            <div style={{ fontSize: 13, color: '#515050' }}>{job.status === 'succeeded' ? tx('pos.agent_is_ready') : job.status === 'failed' ? (job.safeErrorMessage || tx('pos.provisioning_failed')) : (job.currentStepLabel || tx('growth.frontDesk.starting'))}</div>
            {job.status === 'failed' && job.errorCode === 'PROVIDER_NOT_CONNECTED' && (
              <div style={{ fontSize: 11.5, color: '#9B6B1E', background: '#FBEEDD', borderRadius: 8, padding: '8px 10px', marginTop: 8 }}>{tx('pos.connect_a_retell_account_set_the_1910')}</div>
            )}
            {(job.status === 'succeeded' || job.status === 'failed') && (
              <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button style={btnGold} onClick={() => setJob(null)}>{tx('pos.close')}</button>
                {job.status === 'failed' && <button style={{ ...inputStyle, width: 'auto', padding: '0 14px', cursor: 'pointer' }} onClick={() => { const id = job.agentId; setJob(null); provision(id); }}>{tx('pos.retry')}</button>}
              </div>
            )}
          </div>
        </div>
      )}

      {creating && (
        <section style={cardBox}>
          <div style={headStyle}>{tx('pos.create_ai_front_desk_agent')}</div>
          <div style={{ fontSize: 11.5, color: '#8A7A66', marginBottom: 12 }}>{tx('pos.saved_as_a_draft_using_your_139k')}</div>
          <div style={{  gap: 12 }} className="grid grid-cols-1 sm:grid-cols-2">
            <label style={{ fontSize: 12 }}>{tx('pos.agent_name')}<input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={tx('pos.main_front_desk')} /></label>
            <label style={{ fontSize: 12 }}>{tx('pos.use_case')}<input style={inputStyle} value={form.useCase} onChange={(e) => setForm({ ...form, useCase: e.target.value })} placeholder={tx('pos.after_hours_receptionist')} /></label>
            <label style={{ fontSize: 12 }}>{tx('pos.call_type')}<select style={inputStyle} value={form.callType} onChange={(e) => setForm({ ...form, callType: e.target.value })}><option value="inbound">{tx('pos.inbound')}</option></select></label>
            {/* Kevin (Oct 28 2026): every agent speaks English — no language choice */}
            <label style={{ fontSize: 12 }}>{tx('pos.language')}<span style={{ ...inputStyle, display: 'block' }} data-testid="agent-language">{tx('growth.aiReceptionist.englishOnly')}</span></label>
          </div>
          {formErr ? <div style={{ color: '#B4673B', fontSize: 12, marginTop: 10 }}>{formErr}</div> : null}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            <button style={btnGold} disabled={busy} onClick={submit}>{busy ? tx('pos.saving_2') : tx('pos.save_draft_2')}</button>
            <button style={{ ...inputStyle, width: 'auto', padding: '0 14px', cursor: 'pointer' }} onClick={() => setCreating(false)}>{tx('pos.cancel')}</button>
          </div>
        </section>
      )}

      <section style={cardBox}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)} style={{ height: 30, padding: '0 12px', borderRadius: 999, border: '1px solid var(--line)', background: filter === f ? '#F0D4AB' : '#FFFCF6', color: filter === f ? '#7A5518' : '#6C6965', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize' }}>{f} {counts[f] ? `(${counts[f]})` : ''}</button>
          ))}
        </div>

        {shown.length === 0 ? (
          <div style={{ fontSize: 12.5, color: '#9B8B78', padding: '18px 0', textAlign: 'center' }}>
            {agents.length === 0 ? tx('pos.no_agents_yet_create_your_first_1yqb') : tx('pos.no_agents_match_this_filter')}
          </div>
        ) : (
          <div className="overflow-x-auto w-full"><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }} className="w-full min-w-max">
            <thead><tr style={{ textAlign: 'left', color: '#8A7A66' }}><th style={{ padding: '6px 8px' }}>{tx('pos.name')}</th><th style={{ padding: '6px 8px' }}>{tx('pos.call_type')}</th><th style={{ padding: '6px 8px' }}>{tx('pos.language')}</th><th style={{ padding: '6px 8px' }}>{tx('pos.version')}</th><th style={{ padding: '6px 8px' }}>{tx('pos.status')}</th><th style={{ padding: '6px 8px' }}>{tx('pos.actions')}</th></tr></thead>
            <tbody>
              {shown.map((a) => {
                const t = STATUS_TONE[a.status] ?? STATUS_TONE.draft;
                return (
                  <tr key={a.id} style={{ borderTop: '1px solid var(--line)' }}>
                    <td style={{ padding: '8px' }}><div style={{ fontWeight: 600 }}>{a.name}</div>{a.useCase ? <div style={{ fontSize: 11, color: '#8A7A66' }}>{a.useCase}</div> : null}</td>
                    <td style={{ padding: '8px', textTransform: 'capitalize' }}>{a.callType}</td>
                    <td style={{ padding: '8px', textTransform: 'uppercase' }}>EN</td>
                    <td style={{ padding: '8px' }}>v{a.knowledgeVersion}</td>
                    <td style={{ padding: '8px' }}><span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: t.bg, color: t.fg, textTransform: 'capitalize' }}>{growthCode(a.status)}</span></td>
                    <td style={{ padding: '8px' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {a.status === 'draft' && <button style={{ ...linkBtn, color: GOLD }} onClick={() => provision(a.id)}>{tx('pos.provision')}</button>}
                        {a.status === 'draft' && <button style={linkBtn} onClick={() => act(a.id, 'paused')}>{tx('pos.pause')}</button>}
                        {a.status === 'paused' && <button style={linkBtn} onClick={() => act(a.id, 'draft')}>{tx('pos.resume')}</button>}
                        {a.status !== 'archived' && <button style={{ ...linkBtn, color: '#B4673B' }} onClick={() => act(a.id, 'archived')}>{tx('pos.archive')}</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </section>

      <div style={{ fontSize: 11.5, color: '#9B8B78' }}>{tx('pos.agents_are_saved_as_drafts_bringing_1gvo')}{' '}<button style={{ ...linkBtn, color: GOLD }} onClick={() => nav('/tenant/ai/receptionist')}>{tx('pos.open_command_center')}</button></div>
    </div>
  );
}

const linkBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#6C6965', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'inherit' };
