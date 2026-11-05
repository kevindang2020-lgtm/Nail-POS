// POSAIBusinessSetupScreen.tsx — Business Setup (spec Page 3). This is a READINESS + FAQ layer over the salon's real
// data: it reuses the existing services and technicians endpoints and the receptionist overview (store hours) to show
// what the AI will know, honestly flagging gaps. It does NOT duplicate that data — services/hours/technicians are read
// from their existing sources. The only thing it owns is customer-facing FAQs (new, approved Q&A the AI may answer).
import { useEffect, useState } from 'react';
import { useInlineConfirm } from '@aipowersalon/ui';
import { useNavigate } from 'react-router-dom';
import { posAiApi, type ReceptionistFaq, type ReceptionistOverview } from '../api/posAiApi';
import { posServicesApi } from '../api/posServicesApi';
import { posTechniciansApi } from '../api/posTechniciansApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';

const cardBox: React.CSSProperties = { background: '#FFFCF6', border: '1px solid var(--line)', borderRadius: 14, padding: 14 };
const headStyle: React.CSSProperties = { fontWeight: 800, fontSize: 13.5, marginBottom: 10, fontFamily: 'var(--aps-font-head, Playfair Display)' };
const GOLD = '#A96F22';
const inputStyle: React.CSSProperties = { height: 34, padding: '0 10px', borderRadius: 8, border: '1px solid var(--line)', background: '#fff', fontSize: 13, fontFamily: 'inherit', width: '100%' };
const btnGold: React.CSSProperties = { height: 34, padding: '0 14px', borderRadius: 8, border: 'none', background: GOLD, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#6C6965', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'inherit' };

function ReadinessRow({ label, ready, detail, onEdit }: { label: string; ready: boolean; detail: string; onEdit?: () => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--line)' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: ready ? '#3E8F57' : '#C89A3C', flexShrink: 0 }} />
      <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div><div style={{ fontSize: 11.5, color: '#8A7A66' }}>{detail}</div></div>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: ready ? '#3E8F57' : '#9B6B1E' }}>{ready ? t('pos.ready') : t('pos.needs_setup')}</span>
      {onEdit ? <button style={{ ...linkBtn, color: GOLD }} onClick={onEdit}>{t('pos.edit')}</button> : null}
    </div>
  );
}

export function POSAIBusinessSetupScreen() {
  const nav = useNavigate();
  const [ov, setOv] = useState<ReceptionistOverview | null>(null);
  const [serviceCount, setServiceCount] = useState<number | null>(null);
  const [techCount, setTechCount] = useState<number | null>(null);
  const [faqs, setFaqs] = useState<ReceptionistFaq[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ question: '', answer: '', category: '' });
  const [busy, setBusy] = useState(false);

  const loadFaqs = () => posAiApi.receptionistFaqs().then(setFaqs).catch(() => setFaqs([]));
  useEffect(() => {
    posAiApi.receptionistOverview().then(setOv).catch((e: any) => setError(e?.message || t('pos.failed_to_load_business_setup')));
    posServicesApi.list().then((r: any) => setServiceCount(Array.isArray(r) ? r.length : (r?.services?.length ?? 0))).catch(() => setServiceCount(null));
    // the team's true size (the list is paged: its first page held at most 20 technicians)
    posTechniciansApi.list({ pageSize: 1 }).then((r: any) => setTechCount(Array.isArray(r) ? r.length : Number(r?.pagination?.totalItems ?? r?.technicians?.length ?? 0))).catch(() => setTechCount(null));
    loadFaqs();
  }, []);

  const addFaq = async () => {
    if (!form.question.trim() || !form.answer.trim()) { setError(t('pos.a_question_and_answer_are_both_1buc')); return; }
    setBusy(true); setError(null);
    try { await posAiApi.createReceptionistFaq({ question: form.question.trim(), answer: form.answer.trim(), category: form.category.trim() || undefined }); setForm({ question: '', answer: '', category: '' }); await loadFaqs(); }
    catch (e: any) { setError(e?.message || t('pos.could_not_add_the_faq')); }
    finally { setBusy(false); }
  };
  const toggleFaq = async (f: ReceptionistFaq) => { try { await posAiApi.updateReceptionistFaq(f.id, { isActive: !f.isActive }); await loadFaqs(); } catch (e: any) { setError(e?.message || t('pos.action_failed')); } };
  const { confirm: askConfirm, confirmUi } = useInlineConfirm();
  const delFaq = (id: string) => askConfirm(t('growth.businessSetup.deleteFaq'), () => { void doDelFaq(id); }, { confirmLabel: t('pos.delete_faq') });
  const doDelFaq = async (id: string) => { try { await posAiApi.deleteReceptionistFaq(id); await loadFaqs(); } catch (e: any) { setError(e?.message || t('pos.action_failed')); } };

  const hoursReady = !!ov && ov.checklist.find((c) => c.key === 'business_setup')?.state === 'done';

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {confirmUi}
      <div className="vh flex flex-col sm:flex-row gap-3 justify-between"><div>
        <div>
          <h1>{t('pos.business_setup')}</h1>
        <div className="sub mb-3">{t('pos.what_your_ai_receptionist_knows_u2014_5je7')}</div>
        </div></div></div>
      {error ? <div className="err">{error} <button className="btn w-fit whitespace-nowrap" onClick={() => setError(null)}>{t('pos.dismiss')}</button></div> : null}

      <section style={cardBox}>
        <div style={headStyle}>{t('pos.readiness')}</div>
        <div style={{ fontSize: 11.5, color: '#8A7A66', marginBottom: 4 }}>{t('pos.these_are_read_from_your_existing_1f0n')}</div>
        <ReadinessRow label={t('pos.business_hours')} ready={hoursReady} detail={hoursReady ? t('pos.store_hours_are_configured') : t('pos.set_your_store_hours_so_the_7f2d')} onEdit={() => nav('/settings?section=auto-logout')} />
        <ReadinessRow label={t('pos.services')} ready={(serviceCount ?? 0) > 0} detail={serviceCount == null ? t('pos.could_not_load_your_services') : t('pos.servicecount_service_plural_available_for_booking_quep', { serviceCount: String(serviceCount), plural: String(serviceCount === 1 ? '' : 's') })} onEdit={() => nav('/services')} />
        <ReadinessRow label={t('pos.technicians')} ready={(techCount ?? 0) > 0} detail={techCount == null ? t('pos.could_not_load_your_technicians') : t('pos.techcount_technician_plural_on_file', { techCount: String(techCount), plural: String(techCount === 1 ? '' : 's') })} onEdit={() => nav('/technicians')} />
      </section>

      <section style={cardBox}>
        <div style={headStyle}>{t('pos.customer_faqs')}</div>
        <div style={{ fontSize: 11.5, color: '#8A7A66', marginBottom: 12 }}>{t('pos.approved_answers_the_ai_may_give_1iby')}</div>
        <div style={{  gap: 10 }} className="grid grid-cols-1 sm:grid-cols-2">
          <input style={inputStyle} placeholder={t('pos.question_e_g_do_you_take_qu9l')} value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} />
          <input style={inputStyle} placeholder={t('pos.category_optional')} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        </div>
        <textarea style={{ ...inputStyle, height: 56, padding: 8, marginTop: 10 }} placeholder={t('pos.approved_answer')} value={form.answer} onChange={(e) => setForm({ ...form, answer: e.target.value })} />
        <div style={{ marginTop: 10 }}><button style={btnGold} disabled={busy} onClick={addFaq}>{busy ? t('pos.adding') : t('pos.add_faq')}</button></div>

        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {faqs === null ? <div style={{ fontSize: 12.5, color: '#9B8B78' }}>{t('pos.loading_faqs_u2026')}</div>
            : faqs.length === 0 ? <div style={{ fontSize: 12.5, color: '#9B8B78' }}>{t('pos.no_faqs_yet_u2014_add_the_1dow')}</div>
            : faqs.map((f) => (
              <div key={f.id} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10, opacity: f.isActive ? 1 : 0.6 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{f.question}</span>
                  {f.category ? <span style={{ fontSize: 10.5, color: '#9B8B78', background: '#F3ECE1', padding: '1px 8px', borderRadius: 999 }}>{f.category}</span> : null}
                  {!f.isActive ? <span style={{ fontSize: 10.5, color: '#9B6B1E' }}>{t('pos.inactive')}</span> : null}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                    <button style={linkBtn} onClick={() => toggleFaq(f)}>{f.isActive ? t('pos.disable') : t('pos.enable')}</button>
                    <button style={{ ...linkBtn, color: '#B4673B' }} onClick={() => delFaq(f.id)}>{t('pos.delete')}</button>
                  </div>
                </div>
                <div style={{ fontSize: 12.5, color: '#515050', marginTop: 4 }}>{f.answer}</div>
              </div>
            ))}
        </div>
      </section>

      <div style={{ fontSize: 11.5, color: '#9B8B78' }}><button style={{ ...linkBtn, color: GOLD }} onClick={() => nav('/tenant/ai/receptionist')}>{t('pos.back_to_command_center')}</button></div>
    </div>
  );
}
