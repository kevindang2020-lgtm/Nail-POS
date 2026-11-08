// POSAICampaignBuilderScreen.tsx — AI Center → AI Marketing → Campaign Builder (/tenant/ai/marketing/builder). Campaign Builder guide
// (Nov 3 2026). Goal → Audience → Message → Offer → Schedule → Review (the guide's six steps, restored Nov 8 2026 by the SUNMI addendum:
// Offer reuses an APPROVED Deals & Promotions offer or "No offer"; Schedule PROPOSES a send time in salon time, checked for DST, quiet
// hours and the offer's dates, with the budget / cost cap beside it). A Next click NEVER sends, schedules or approves anything.
//
// Before: the last step called the AI "submit" and "approve" routes, which created a campaign from a hand-carried audience size and
// moved it straight to Scheduled — no Campaign Center approval (content hash), no audience snapshot, and the send worker then sent
// it. Now the last step saves the recommendation as an UNSENT Customer Segments audience (consent-checked on the server) and an
// UNAPPROVED Campaign Center draft that uses it; an owner or manager reviews, approves and launches it in Campaign Center, where the
// send-time checks (consent, opt-outs, quiet hours, limits, idempotency) run. Placeholders Campaign Center cannot fill per customer
// are refused before saving.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ErrorRetry } from '../components/FitKit';
import { DateField } from '../components/FinanceKit';
import { deviceToday } from '../lib/deviceToday';
import { MkFunnel, MkEstimate, MkHealthButton, mt, mkErr, mkMoney, mkNum } from '../components/MarketingKit';
import { posAIMarketingApi } from '../api/posAIMarketingApi';

const STEPS = ['goal', 'audience', 'message', 'offer', 'schedule', 'review'] as const;
const TIMES = Array.from({ length: 64 }, (_, i) => { const m = 6 * 60 + i * 15; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; });   // 06:00 – 21:45
type Step = (typeof STEPS)[number];
const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`);

export function POSAICampaignBuilderScreen() {
  const [sp] = useSearchParams();
  const [step, setStep] = useState<Step>('goal');
  const [kind, setKind] = useState<'rebooking' | 'winback' | null>(sp.get('kind') === 'rebooking' || sp.get('kind') === 'winback' ? (sp.get('kind') as 'rebooking' | 'winback') : null);
  const [channel, setChannel] = useState<'sms' | 'email'>(sp.get('channel') === 'email' ? 'email' : 'sms');
  const [name, setName] = useState('');
  const [message, setMessage] = useState(sp.get('message') ?? '');
  const [subject, setSubject] = useState('');
  const [budget, setBudget] = useState('');
  const [rec, setRec] = useState<any>(null);
  const [recErr, setRecErr] = useState<string | null>(null);
  const [recTick, setRecTick] = useState(0);
  const [est, setEst] = useState<any>(null);
  const [gate, setGate] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<any>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [offers, setOffers] = useState<any[] | null>(null); const [offersErr, setOffersErr] = useState<string | null>(null);
  const [dealId, setDealId] = useState<string>('');   // '' = No offer
  const [sendDate, setSendDate] = useState(''); const [sendTime, setSendTime] = useState('10:00');
  const [sched, setSched] = useState<any>(null); const [schedErr, setSchedErr] = useState<string | null>(null);
  const key = useMemo(newKey, [kind, channel]);   // one save per goal + channel: a double tap or a retry returns the same draft

  useEffect(() => {
    if (!kind) return; let on = true; setRec(null); setRecErr(null);
    posAIMarketingApi.center.recommendations(channel).then((r) => {
      if (!on) return; const it = (r.items ?? []).find((x: any) => x.kind === kind) ?? null; setRec(it);
      if (it?.message && !message) { setMessage(it.message.body ?? ''); if (!subject && it.message.subject) setSubject(it.message.subject); if (!name && it.message.name) setName(it.message.name); }
    }).catch((e) => on && setRecErr(mkErr(e)));
    return () => { on = false; };
  }, [kind, channel, recTick]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if ((step !== 'offer' && step !== 'review') || offers) return; let on = true;
    posAIMarketingApi.center.offers().then((r) => on && setOffers(r.items ?? [])).catch((e) => on && setOffersErr(mkErr(e)));
    return () => { on = false; };
  }, [step, offers]);
  useEffect(() => {
    setSched(null); setSchedErr(null);   // never judge a new time by the previous answer
    if (!sendDate) return; let on = true;
    const t = setTimeout(() => { posAIMarketingApi.center.scheduleCheck({ date: sendDate, time: sendTime, dealId: dealId || null }).then((r) => on && setSched(r)).catch((e) => on && setSchedErr(mkErr(e))); }, 250);
    return () => { on = false; clearTimeout(t); };
  }, [sendDate, sendTime, dealId]);
  const offer = offers?.find((o) => o.id === dealId) ?? null;
  const budgetCents = budget.trim() === '' ? null : Math.round(Number(budget) * 100);
  const eligible = rec?.eligible ?? 0;
  const ready: Record<Step, string | null> = {
    goal: kind ? null : 'amk.b.gate.goal',
    audience: rec && rec.status === 'ready' ? null : 'amk.b.gate.audience',
    message: !message.trim() ? 'amk.b.gate.message' : channel === 'email' && !subject.trim() ? 'amk.b.gate.subject' : est?.unresolved?.length ? 'amk.b.gate.tokens' : null,
    offer: dealId && offers && !offer ? 'amk.b.gate.offer' : null,
    schedule: budgetCents != null && (!Number.isFinite(budgetCents) || budgetCents < 0) ? 'amk.b.gate.budget' : sendDate && (!sched || !sched.ok) ? 'amk.b.gate.schedule' : null,
    review: null,
  };
  const i = STEPS.indexOf(step);
  const go = (to: Step) => { const j = STEPS.indexOf(to); for (let x = 0; x < j; x++) { const g = ready[STEPS[x]]; if (g) { setGate(g); setStep(STEPS[x]); return; } } setGate(null); setStep(to); };
  const save = () => {
    if (!kind) return; setSaving(true); setSaveErr(null);
    posAIMarketingApi.center.saveDraft({ kind, channel, name: name.trim() || null, message, subject: channel === 'email' ? subject : null, budgetCents, idempotencyKey: key,
      dealId: dealId || null, sendDate: sendDate || null, sendTime: sendDate ? sendTime : null })
      .then(setSaved).catch((e) => setSaveErr(mkErr(e))).finally(() => setSaving(false));
  };

  return (
    <div className="work rvw" data-testid="amk-builder">
      <div className="rvw-head">
        <div className="vh"><h1>{mt('amk.b.title')}</h1><div className="sub">{mt('amk.b.sub')}</div></div>
        <div className="rvw-actions"><MkHealthButton /><Link className="btn ghost" to="/tenant/marketing/campaigns">{mt('amk.b.openCenter')}</Link></div>
      </div>
      <div className="amk-steps" role="tablist" data-testid="amk-steps">{STEPS.map((s, n) => <button key={s} type="button" role="tab" aria-selected={step === s} className={'btn ghost' + (step === s ? ' on' : '')} data-testid={`amk-step-${s}`} onClick={() => go(s)}>{n + 1}. {mt('amk.b.step.' + s)}</button>)}</div>
      {gate ? <div className="err" data-testid="amk-gate">{mt(gate)}</div> : null}

      <section className="panel" style={{ padding: 12 }}>
        {step === 'goal' ? <>
          <div className="amk-recs">{(['rebooking', 'winback'] as const).map((k) => (
            <button key={k} type="button" className="amk-rec" data-testid={`amk-b-kind-${k}`} aria-pressed={kind === k} onClick={() => { setKind(k); setGate(null); }} style={{ textAlign: 'left', cursor: 'pointer', borderColor: kind === k ? 'var(--gold)' : undefined }}>
              <b>{mt('amk.kind.' + k)}</b><span className="sub">{mt('amk.kindDesc.' + k)}</span></button>))}
          </div>
          <p className="sub">{mt('amk.b.birthdayElsewhere')} <Link className="link-44" to="/tenant/marketing/birthdays">{mt('amk.openBirthdays')}</Link></p>
          <div className="rvw-dates">{(['sms', 'email'] as const).map((c) => <button key={c} type="button" className={'btn ghost' + (channel === c ? ' on' : '')} data-testid={`amk-b-ch-${c}`} onClick={() => setChannel(c)}>{mt('amk.channel.' + c)}</button>)}</div>
          <label className="rvw-f block"><span>{mt('amk.b.name')}</span><input data-testid="amk-b-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder={mt('amk.b.namePh')} /></label>
        </> : null}

        {step === 'audience' && kind ? <>
          {recErr ? <ErrorRetry message={recErr} onRetry={() => setRecTick((n) => n + 1)} /> : rec ? <p data-testid="amk-b-aud-status"><b>{mt('amk.recStatus.' + rec.status)}</b> · {mt('amk.recCounts', { m: mkNum(rec.matched), e: mkNum(rec.eligible), x: mkNum(rec.excludedTotal) })}</p> : null}
          <MkFunnel kind={kind} channel={channel} />
        </> : null}

        {step === 'message' ? <>
          {channel === 'email' ? <label className="rvw-f block"><span>{mt('amk.b.subject')}</span><input data-testid="amk-b-subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} /></label> : null}
          <label className="rvw-f block"><span>{mt('amk.b.message')}</span><textarea data-testid="amk-b-message" value={message} maxLength={1600} rows={5} onChange={(e) => setMessage(e.target.value)} placeholder={mt('amk.b.messagePh')} /></label>
          <p className="sub">{mt('amk.b.vars')} <Link to="/tenant/ai/marketing/studio">{mt('amk.b.studio')}</Link></p>
          <MkEstimate channel={channel} body={message} recipients={eligible} budgetCents={budgetCents} onResult={setEst} />
        </> : null}

        {step === 'offer' ? <div className="amk-offer" data-testid="amk-b-offer">
          {offersErr ? <ErrorRetry message={offersErr} onRetry={() => { setOffersErr(null); setOffers(null); }} /> : !offers ? <div className="state">{mt('amk.loading')}</div> : <>
            <div className="amk-offer-list" role="radiogroup" aria-label={mt('amk.b.step.offer')}>
              <button type="button" role="radio" aria-checked={!dealId} className={'amk-offer-card' + (!dealId ? ' on' : '')} data-testid="amk-b-offer-none" onClick={() => setDealId('')}>
                <b>{mt('amk.b.offer.none')}</b><span className="sub">{mt('amk.b.offer.noneDesc')}</span></button>
              {offers.map((o) => (
                <button key={o.id} type="button" role="radio" aria-checked={dealId === o.id} className={'amk-offer-card' + (dealId === o.id ? ' on' : '')} data-testid="amk-b-offer-card" onClick={() => setDealId(o.id)}>
                  <b>{o.title}</b>
                  <span className="sub">{o.discount.type === 'percent' ? mt('amk.b.offer.pct', { p: String(o.discount.percent) }) : mt('amk.b.offer.off', { v: mkMoney(o.discount.cents) })} · {mt('amk.b.offer.status.' + o.status)}</span>
                  <span className="sub">{o.endsAt ? mt('amk.b.offer.ends', { d: o.endsAt.slice(0, 10) }) : mt('amk.b.offer.noEnd')}</span>
                </button>))}
            </div>
            {offers.length === 0 ? <p className="sub" data-testid="amk-b-offer-empty">{mt('amk.b.offer.empty')} <Link className="link-44" to="/tenant/marketing/promotions">{mt('amk.b.offer.openPromos')}</Link></p> : null}
            <aside className="amk-offer-terms panel" data-testid="amk-b-offer-terms">
              {offer ? <>
                <b>{offer.title}</b>
                <dl className="amk-dl">
                  <dt>{mt('amk.b.offer.t.valid')}</dt><dd>{offer.startsAt ? offer.startsAt.slice(0, 10) : '—'} → {offer.endsAt ? offer.endsAt.slice(0, 10) : mt('amk.b.offer.noEnd')}</dd>
                  <dt>{mt('amk.b.offer.t.min')}</dt><dd>{offer.minSpendCents != null ? mkMoney(offer.minSpendCents) : '—'}</dd>
                  <dt>{mt('amk.b.offer.t.caps')}</dt><dd>{offer.maxRedemptions != null ? mt('amk.b.offer.t.capsV', { u: mkNum(offer.redeemed), m: mkNum(offer.maxRedemptions) }) : mt('amk.b.offer.t.noCap')}{offer.maxPerCustomer != null ? ` · ${mt('amk.b.offer.t.perCust', { n: mkNum(offer.maxPerCustomer) })}` : ''}</dd>
                  <dt>{mt('amk.b.offer.t.who')}</dt><dd>{[offer.newCustomersOnly ? mt('amk.b.offer.t.new') : null, offer.memberOnly ? mt('amk.b.offer.t.members') : null, offer.allBranches ? mt('amk.b.offer.t.allBranches') : mt('amk.b.offer.t.thisBranch')].filter(Boolean).join(' · ')}</dd>
                  <dt>{mt('amk.b.offer.t.stack')}</dt><dd>{offer.stackable ? mt('amk.b.offer.t.stackYes') : mt('amk.b.offer.t.stackNo')}{offer.requiresCode ? ` · ${mt('amk.b.offer.t.code')}` : ''}</dd>
                </dl>
                {offer.terms ? <p className="sub" style={{ whiteSpace: 'pre-wrap' }}>{offer.terms}</p> : null}
                <p className="sub">{mt('amk.b.offer.exposure')}</p>
              </> : <p className="sub">{mt('amk.b.offer.noneTerms')}</p>}
            </aside>
          </>}
        </div> : null}

        {step === 'schedule' ? <div className="amk-sched" data-testid="amk-b-schedule">
          <div className="amk-sched-main">
            <DateField label={mt('amk.b.sched.date')} value={sendDate} onChange={setSendDate} today={deviceToday()} testId="amk-b-date" />
            <label className="rvw-f"><span>{mt('amk.b.sched.time')}</span><select data-testid="amk-b-time" value={sendTime} onChange={(e) => setSendTime(e.target.value)} disabled={!sendDate}>{TIMES.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
            {sendDate ? <button type="button" className="btn ghost" data-testid="amk-b-date-clear" onClick={() => setSendDate('')}>{mt('amk.b.sched.clear')}</button> : null}
            <p className="sub">{sendDate ? mt('amk.b.sched.proposalNote') : mt('amk.b.sched.none')}</p>
            <label className="rvw-f"><span>{mt('amk.b.budget')}</span><input type="number" min={0} step="0.01" data-testid="amk-b-budget" value={budget} onChange={(e) => setBudget(e.target.value)} /></label>
            <p className="sub">{mt('amk.b.budgetNote')}</p>
          </div>
          <aside className="amk-sched-side panel" data-testid="amk-b-readiness">
            <b>{mt('amk.b.sched.readiness')}</b>
            {!sendDate ? <p className="sub">{mt('amk.b.sched.readinessNone')}</p> : schedErr ? <div className="err">{schedErr}</div> : !sched ? <div className="state">{mt('amk.loading')}</div> : <>
              <p className="sub">{mt('amk.b.sched.zone', { tz: sched.timeZone })}</p>
              <ul className="amk-checks">{sched.checks.map((c: any) => <li key={c.key} className={'amk-ck ' + c.state} data-testid={`amk-b-ck-${c.key}`}><b>{mt('amk.b.sched.ck.' + c.state)}</b> {c.detail}</li>)}</ul>
            </>}
            <MkEstimate channel={channel} body={message} recipients={eligible} budgetCents={budgetCents} onResult={setEst} />
          </aside>
        </div> : null}

        {step === 'review' ? (saved ? (
          <div data-testid="amk-b-saved">
            <p><b>{saved.duplicate ? mt('amk.b.savedAgain') : mt('amk.b.saved')}</b></p>
            <p>{mt('amk.b.savedCounts', { e: mkNum(saved.eligible), x: mkNum(saved.excluded) })}</p>
            <p className="sub">{mt('amk.b.notSent')}</p>
            <Link className="btn" data-testid="amk-b-open" to={`/tenant/marketing/campaigns?q=${encodeURIComponent(saved.campaignId)}`}>{mt('amk.b.reviewInCenter')}</Link>
          </div>) : (
          <div data-testid="amk-b-review">
            <table className="tbl"><tbody>
              <tr><td>{mt('amk.b.r.goal')}</td><td>{kind ? mt('amk.kind.' + kind) : '—'} · {mt('amk.channel.' + channel)}</td></tr>
              <tr><td>{mt('amk.b.r.audience')}</td><td>{mt('amk.recCounts', { m: mkNum(rec?.matched), e: mkNum(rec?.eligible), x: mkNum(rec?.excludedTotal) })}</td></tr>
              <tr><td>{mt('amk.b.r.message')}</td><td style={{ whiteSpace: 'pre-wrap' }}>{channel === 'email' ? <b>{subject}<br /></b> : null}{est?.asSent ?? message}</td></tr>
              <tr><td>{mt('amk.b.r.offer')}</td><td data-testid="amk-b-r-offer">{offer ? offer.title : mt('amk.b.offer.none')}</td></tr>
              <tr><td>{mt('amk.b.r.when')}</td><td data-testid="amk-b-r-when">{sendDate && sched?.ok ? mt('amk.b.r.whenV', { d: sendDate, t: sendTime, tz: sched.timeZone }) : mt('amk.b.r.whenNone')}</td></tr>
              <tr><td>{mt('amk.b.r.cost')}</td><td>{est?.estimatedCostCents != null ? mkMoney(est.estimatedCostCents) : mt('amk.est.note.' + (est?.costNote ?? 'not_priced'))}{budgetCents != null ? ` · ${mt('amk.b.r.budget', { b: mkMoney(budgetCents) })}` : ''}</td></tr>
            </tbody></table>
            {est?.withinBudget === false ? <div className="err">{mt('amk.est.overBudget', { b: mkMoney(budgetCents) })}</div> : null}
            <p className="sub">{mt('amk.b.reviewNote')}</p>
            {saveErr ? <div className="err" data-testid="amk-b-err">{saveErr}</div> : null}
            <button type="button" className="btn" data-testid="amk-b-save" disabled={saving || !!Object.values(ready).find(Boolean)} onClick={save}>{saving ? mt('amk.b.saving') : mt('amk.b.save')}</button>
          </div>)) : null}
      </section>

      <div className="rvw-actions" style={{ marginTop: 10 }}>
        {i > 0 ? <button type="button" className="btn ghost" data-testid="amk-b-back" onClick={() => { setGate(null); setStep(STEPS[i - 1]); }}>{mt('amk.b.back')}</button> : null}
        {i < STEPS.length - 1 ? <button type="button" className="btn" data-testid="amk-b-next" onClick={() => go(STEPS[i + 1])}>{mt('amk.b.next')}</button> : null}
      </div>
    </div>
  );
}
