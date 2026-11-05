// AdEditor.tsx — + ADD ADVERTISEMENT / Edit (23-inch dual-screen spec §49–§57, §61, §65, §78). Simple mode first (§53):
// upload an image and publish — every other field is optional. The live 23-inch preview beside the form uses the
// display's own renderer, so what the owner sees is what customers will see. The server re-validates everything.
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { DISPLAY_AD_FIT_MODES, DISPLAY_AD_QR_KINDS, DISPLAY_AD_QR_LABELS, DISPLAY_AD_RULES, type DisplayAdFitMode, type DisplayAdQrKind } from '@aipowersalon/api-contracts';
import type { DisplayAdInput, DisplayAdMediaView, DisplayAdsState, DisplayAdView } from '@aipowersalon/api-contracts/tenant';
import { posDisplayAdsApi, mediaUrl } from '../../api/posDisplayAdsApi';
import { prepareAdImage } from './adImagePipeline';
import { DisplayPreview } from './DisplayPreview';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { codeLabel, weekdayShort } from '../../components/codeLabel';

const DAYS = [0, 1, 2, 3, 4, 5, 6];   // Sunday … Saturday — the label is weekdayShort(d), read at render
const fitLabel = (m: DisplayAdFitMode) => codeLabel('admin.ads.fit', m);

interface Form {
  name: string; headline: string; subheadline: string; description: string; ctaText: string;
  qrKind: '' | DisplayAdQrKind; qrUrl: string;
  fitMode: DisplayAdFitMode; focalX: number; focalY: number;
  startDate: string; endDate: string; days: number[]; dailyStart: string; dailyEnd: string;
  duration: string; priority: string;
  allBranches: boolean; branchIds: string[];
  media: DisplayAdMediaView | null; fullscreenMedia: DisplayAdMediaView | null;
}

function formOf(ad: DisplayAdView | null, st: DisplayAdsState): Form {
  const ownBranch = st.authorizedBranchIds[0] ?? '';
  return {
    name: ad?.name ?? '', headline: ad?.headline ?? '', subheadline: ad?.subheadline ?? '', description: ad?.description ?? '', ctaText: ad?.ctaText ?? '',
    qrKind: ad?.qr?.kind ?? '', qrUrl: ad?.qr?.url ?? '',
    fitMode: ad?.fitMode ?? 'cover', focalX: ad?.focalX ?? 0.5, focalY: ad?.focalY ?? 0.5,
    startDate: ad?.startDate ?? '', endDate: ad?.endDate ?? '', days: ad?.daysOfWeek ?? [], dailyStart: ad?.dailyStartTime ?? '', dailyEnd: ad?.dailyEndTime ?? '',
    duration: ad?.displayDurationSeconds != null ? String(ad.displayDurationSeconds) : '', priority: String(ad?.priority ?? 0),
    allBranches: ad ? ad.allBranches : st.canManageAllBranches, branchIds: ad ? ad.branchIds : (st.canManageAllBranches ? [] : (ownBranch ? [ownBranch] : [])),
    media: ad?.media ?? null, fullscreenMedia: ad?.fullscreenMedia ?? null,
  };
}

/** What goes to the server — every field, so an edit can also CLEAR a field. Numbers stay numbers. */
export function inputOf(f: Form): DisplayAdInput {
  const t = (s: string) => (s.trim() ? s.trim() : null);
  return {
    name: f.name.trim(), mediaId: f.media?.id ?? null, fullscreenMediaId: f.fullscreenMedia?.id ?? null,
    headline: t(f.headline), subheadline: t(f.subheadline), description: t(f.description), ctaText: t(f.ctaText),
    qr: f.qrKind ? { kind: f.qrKind, url: f.qrUrl.trim() } : null,
    fitMode: f.fitMode, focalX: f.focalX, focalY: f.focalY,
    startDate: t(f.startDate), endDate: t(f.endDate), daysOfWeek: f.days.length ? [...f.days].sort() : null,
    dailyStartTime: t(f.dailyStart), dailyEndTime: t(f.dailyEnd),
    displayDurationSeconds: f.duration.trim() ? Number(f.duration) : null, priority: Number(f.priority) || 0,
    allBranches: f.allBranches, branchIds: f.allBranches ? [] : f.branchIds,
  };
}

const kb = (b: number) => (b >= 1024 * 1024 ? tx('pos.v0_mb', { v0: String((b / 1024 / 1024).toFixed(1)) }) : tx('pos.v0_kb_2', { v0: String(Math.max(1, Math.round(b / 1024))) }));

export function AdEditor({ st, ad, salonName, onClose, onSaved }: {
  st: DisplayAdsState; ad: DisplayAdView | null; salonName: string;
  onClose: () => void; onSaved: (view: DisplayAdView, message: string) => void;
}) {
  const [current, setCurrent] = useState<DisplayAdView | null>(ad);
  const [f, setF] = useState<Form>(() => formOf(ad, st));
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<{ msg: string; conflict?: boolean } | null>(null);
  const [warn, setWarn] = useState<string[]>([]);
  const [showText, setShowText] = useState(() => !!(ad && (ad.headline || ad.subheadline || ad.description || ad.ctaText || ad.qr)));
  const [previewMode, setPreviewMode] = useState<'panel' | 'fullscreen'>('panel');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const fsFileRef = useRef<HTMLInputElement | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));
  const canEditTargeting = st.canManageAllBranches;
  const R = DISPLAY_AD_RULES;
  const fullscreenAllowed = st.limits.fullScreenIdleAllowed;

  useEffect(() => { if (current) setF(formOf(current, st)); }, [current]);   // eslint-disable-line react-hooks/exhaustive-deps -- reset only when the saved ad changes

  const upload = async (e: ChangeEvent<HTMLInputElement>, purpose: 'panel' | 'fullscreen') => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setErr(null); setWarn([]); setBusy(purpose === 'panel' ? 'upload' : 'upload-fs');
    let previewUrl: string | null = null;
    try {
      const prepared = await prepareAdImage(file, st.limits, purpose);
      previewUrl = prepared.previewUrl;
      const media = await posDisplayAdsApi.uploadMedia(prepared.form);
      if (purpose === 'panel') {
        setF((p) => ({ ...p, media, name: p.name || file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, R.text.name) }));
      } else { set('fullscreenMedia', media); setPreviewMode('fullscreen'); }
      setWarn(prepared.warnings);
    } catch (x: any) { setErr({ msg: x?.message || tx('pos.the_image_could_not_be_uploaded') }); }
    finally { if (previewUrl) URL.revokeObjectURL(previewUrl); setBusy(null); }
  };

  const pickFocus = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (f.fitMode !== 'cover') return;
    const r = e.currentTarget.getBoundingClientRect();
    setF((p) => ({ ...p, focalX: Math.round(((e.clientX - r.left) / r.width) * 1000) / 1000, focalY: Math.round(((e.clientY - r.top) / r.height) * 1000) / 1000 }));
  };

  const save = async (publish: boolean) => {
    setErr(null); setBusy(publish ? 'publish' : 'save');
    try {
      const body = inputOf(f);
      let view = current
        ? await posDisplayAdsApi.update(current.id, { ...body, expectedVersion: current.version })
        : await posDisplayAdsApi.create(body);
      setCurrent(view);
      if (publish && view.storedStatus !== 'published') view = await posDisplayAdsApi.act(view.id, 'publish', view.version);
      onSaved(view, publish ? tx('pos.name_is_published_v1', { name: String(view.name), v1: String(view.showingNow ? tx('pos.and_showing_now') : view.status === 'SCHEDULED' ? tx('pos.and_scheduled') : '') }) : current ? tx('pos.changes_saved') : tx('pos.name_saved_as_a_draft', { name: String(view.name) }));
    } catch (x: any) {
      const code = x?.code ?? x?.error?.code;
      setErr({ msg: x?.message || tx('pos.the_advertisement_could_not_be_saved'), conflict: code === 'VERSION_CONFLICT' });
    } finally { setBusy(null); }
  };

  const reload = async () => {
    if (!current) return;
    setBusy('reload'); setErr(null);
    try { setCurrent(await posDisplayAdsApi.get(current.id)); } catch (x: any) { setErr({ msg: x?.message || tx('pos.could_not_reload') }); }
    finally { setBusy(null); }
  };

  const previewAd = useMemo(() => {
    const m = previewMode === 'fullscreen' ? f.fullscreenMedia : f.media;
    if (!m) return null;
    const smart = f.fitMode === 'smart_crop';
    return {
      image: previewMode === 'fullscreen' ? m.large : m.medium, fit: f.fitMode,
      focalX: smart ? m.suggestedFocalX : f.focalX, focalY: smart ? m.suggestedFocalY : f.focalY,
      headline: showText ? f.headline.trim() || null : null, subheadline: showText ? f.subheadline.trim() || null : null,
      description: showText ? f.description.trim() || null : null, ctaText: showText ? f.ctaText.trim() || null : null,
      qr: showText && f.qrKind && f.qrUrl.trim() ? { label: DISPLAY_AD_QR_LABELS[f.qrKind], url: f.qrUrl.trim() } : null,
    };
  }, [f, showText, previewMode]);

  const status = current ? current.storedStatus : 'new';
  const branchName = (id: string) => st.branches.find((b) => b.id === id)?.name ?? tx('pos.branch');
  const live = status === 'published';
  const title = current ? tx('pos.edit_advertisement') : tx('pos.add_advertisement_2');

  return (
    <div className="modal-ov" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="dads-editor" onClick={(e) => e.stopPropagation()}>
        <div className="dads-editor-h">
          <div><div className="p-h" style={{ margin: 0 }}>{title}</div><div className="sub">{current ? tx('pos.status_version_version', { status: String(current.status), version: String(current.version) }) : tx('pos.upload_an_image_that_is_all_1e85')}</div></div>
          <button className="btn ghost" onClick={onClose} disabled={!!busy}>{tx('pos.close')}</button>
        </div>
        <div className="dads-editor-b">
          <div className="dads-editor-form">
            {/* 1. image (§53 simple mode) */}
            <section className="dads-sec">
              <div className="dads-sec-h">{tx('pos.image')}</div>
              <div className="sub" style={{ marginBottom: 8 }}>{tx('pos.best_size')}{' '}{R.recommended.panel.width} × {R.recommended.panel.height} {tx('pos.px_portrait_2_3_keep_text_1voy')}{' '}{Math.round(st.limits.maxFileBytes / 1024 / 1024)} {tx('pos.mb')}</div>
              {f.media ? (
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div className="dads-focus" onClick={pickFocus} title={f.fitMode === 'cover' ? tx('pos.tap_the_part_of_the_image_hwh6') : undefined} style={{ cursor: f.fitMode === 'cover' ? 'crosshair' : 'default' }}>
                    <img src={mediaUrl(f.media.thumb.url)} alt={tx('pos.advertisement_image')} />
                    {f.fitMode === 'cover' ? <span className="dads-focus-dot" style={{ left: `${f.focalX * 100}%`, top: `${f.focalY * 100}%` }} /> : null}
                  </div>
                  <div style={{ fontSize: 12.5 }}>
                    <div>{f.media.width} × {f.media.height} {tx('pos.px')}{' '}{kb(f.media.bytes)}</div>
                    <button className="btn ghost" style={{ marginTop: 6 }} onClick={() => fileRef.current?.click()} disabled={!!busy}>{busy === 'upload' ? tx('pos.uploading') : tx('pos.replace_image')}</button>
                  </div>
                </div>
              ) : (
                <button className="btn primary" onClick={() => fileRef.current?.click()} disabled={!!busy}>{busy === 'upload' ? tx('pos.preparing_and_uploading') : tx('pos.upload_image')}</button>
              )}
              <input ref={fileRef} type="file" accept={st.limits.allowedMimeTypes.join(',')} hidden onChange={(e) => upload(e, 'panel')} />
              {warn.length ? <ul className="dads-warn">{warn.map((w) => <li key={w}>{w}</li>)}</ul> : null}
              <div className="lf" style={{ marginTop: 10 }}>
                <label htmlFor="dads-fit">{tx('pos.fit')}</label>
                <select id="dads-fit" value={f.fitMode} onChange={(e) => set('fitMode', e.target.value as DisplayAdFitMode)}>
                  {DISPLAY_AD_FIT_MODES.map((m) => <option key={m} value={m}>{fitLabel(m)}</option>)}
                </select>
              </div>
            </section>

            <section className="dads-sec">
              <div className="lf"><label htmlFor="dads-name">{tx('pos.ad_name_only_you_see_this')}</label><input id="dads-name" value={f.name} maxLength={R.text.name} onChange={(e) => set('name', e.target.value)} placeholder={tx('pos.fall_pedicure_special')} /></div>
              <label className="dads-check"><input type="checkbox" checked={showText} onChange={(e) => setShowText(e.target.checked)} /> {tx('pos.show_text_over_the_image')}</label>
              {showText ? (
                <div className="dads-grid2">
                  <div className="lf"><label htmlFor="dads-h">{tx('pos.headline')}</label><input id="dads-h" value={f.headline} maxLength={R.text.headline} onChange={(e) => set('headline', e.target.value)} placeholder={tx('pos.deluxe_spa_pedicure')} /></div>
                  <div className="lf"><label htmlFor="dads-sh">{tx('pos.subheadline')}</label><input id="dads-sh" value={f.subheadline} maxLength={R.text.subheadline} onChange={(e) => set('subheadline', e.target.value)} placeholder={tx('pos.relax_refresh_renew')} /></div>
                  <div className="lf" style={{ gridColumn: '1 / -1' }}><label htmlFor="dads-d">{tx('pos.description')}</label><input id="dads-d" value={f.description} maxLength={R.text.description} onChange={(e) => set('description', e.target.value)} placeholder={tx('pos.10_off_monday_thursday')} /></div>
                  <div className="lf"><label htmlFor="dads-cta">{tx('pos.call_to_action')}</label><input id="dads-cta" value={f.ctaText} maxLength={R.text.ctaText} onChange={(e) => set('ctaText', e.target.value)} placeholder={tx('pos.ask_your_technician_today')} /></div>
                  <div className="lf"><label htmlFor="dads-qk">{tx('pos.qr_code')}</label>
                    <select id="dads-qk" value={f.qrKind} onChange={(e) => set('qrKind', e.target.value as Form['qrKind'])}>
                      <option value="">{tx('pos.none')}</option>
                      {DISPLAY_AD_QR_KINDS.map((k) => <option key={k} value={k}>{DISPLAY_AD_QR_LABELS[k]}</option>)}
                    </select>
                  </div>
                  {f.qrKind ? <div className="lf" style={{ gridColumn: '1 / -1' }}><label htmlFor="dads-qu">{tx('pos.qr_web_address')}</label><input id="dads-qu" value={f.qrUrl} maxLength={R.text.qrUrl} onChange={(e) => set('qrUrl', e.target.value)} placeholder={f.qrKind === 'instagram' ? 'https://www.instagram.com/yoursalon' : 'https://…'} /></div> : null}
                </div>
              ) : null}
            </section>

            {/* §61 branch targeting */}
            <section className="dads-sec">
              <div className="dads-sec-h">{tx('pos.branches')}</div>
              {canEditTargeting ? (
                <>
                  <label className="dads-check"><input type="radio" name="dads-target" checked={f.allBranches} onChange={() => set('allBranches', true)} /> {tx('pos.all_branches_2')}</label>
                  <label className="dads-check"><input type="radio" name="dads-target" checked={!f.allBranches} onChange={() => set('allBranches', false)} /> {tx('pos.selected_branches')}</label>
                  {!f.allBranches ? (
                    <div className="dads-chips">{st.branches.map((b) => (
                      <label key={b.id} className="dads-check"><input type="checkbox" checked={f.branchIds.includes(b.id)} onChange={(e) => set('branchIds', e.target.checked ? [...f.branchIds, b.id] : f.branchIds.filter((x) => x !== b.id))} /> {b.name}</label>
                    ))}</div>
                  ) : null}
                </>
              ) : <div className="sub">{tx('pos.shows_at_your_branch')}{' '}<strong>{f.branchIds.map(branchName).join(', ') || '—'}</strong></div>}
            </section>

            {/* §65 schedule */}
            <section className="dads-sec">
              <div className="dads-sec-h">{tx('pos.schedule')}{' '}<span className="sub" style={{ fontWeight: 400 }}>{tx('pos.optional_in_each_branch_s_local_bwgs')}</span></div>
              <div className="dads-grid2">
                <div className="lf"><label htmlFor="dads-sd">{tx('pos.start_date')}</label><input id="dads-sd" type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} /></div>
                <div className="lf"><label htmlFor="dads-ed">{tx('pos.end_date')}</label><input id="dads-ed" type="date" value={f.endDate} onChange={(e) => set('endDate', e.target.value)} /></div>
                <div className="lf"><label htmlFor="dads-st">{tx('pos.start_time')}</label><input id="dads-st" type="time" value={f.dailyStart} onChange={(e) => set('dailyStart', e.target.value)} /></div>
                <div className="lf"><label htmlFor="dads-et">{tx('pos.end_time')}</label><input id="dads-et" type="time" value={f.dailyEnd} onChange={(e) => set('dailyEnd', e.target.value)} /></div>
              </div>
              <div className="dads-chips" role="group" aria-label={tx('pos.days_of_week')}>
                {DAYS.map((d, i) => (
                  <button key={d} type="button" className={'seg-btn' + (f.days.includes(i) ? ' on' : '')} aria-pressed={f.days.includes(i)} onClick={() => set('days', f.days.includes(i) ? f.days.filter((x) => x !== i) : [...f.days, i])}>{weekdayShort(d)}</button>
                ))}
                <span className="sub">{f.days.length === 0 || f.days.length === 7 ? tx('pos.every_day') : ''}</span>
              </div>
              <div className="dads-grid2">
                <div className="lf"><label htmlFor="dads-dur">{tx('pos.display_time_seconds')}</label>
                  <select id="dads-dur" value={f.duration} onChange={(e) => set('duration', e.target.value)}>
                    <option value="">{tx('pos.salon_default_2')}{st.settings.tenant.defaultDurationSeconds} s)</option>
                    {Array.from({ length: R.durationSeconds.max - R.durationSeconds.min + 1 }, (_, i) => R.durationSeconds.min + i).map((s) => <option key={s} value={String(s)}>{s} s</option>)}
                  </select>
                </div>
                <div className="lf"><label htmlFor="dads-pr">{tx('pos.priority_higher_plays_first')}</label><input id="dads-pr" type="number" min={R.priority.min} max={R.priority.max} value={f.priority} onChange={(e) => set('priority', e.target.value)} /></div>
              </div>
            </section>

            {/* §56 full-screen creative */}
            {fullscreenAllowed ? (
              <section className="dads-sec">
                <div className="dads-sec-h">{tx('pos.full_screen_image')}{' '}<span className="sub" style={{ fontWeight: 400 }}>{tx('pos.optional_only_used_when_full_screen_1jsi')}</span></div>
                <div className="sub" style={{ marginBottom: 6 }}>{tx('pos.landscape_best')}{' '}{R.recommended.fullscreen.width} × {R.recommended.fullscreen.height} {tx('pos.px_2')}</div>
                {f.fullscreenMedia ? (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <img src={mediaUrl(f.fullscreenMedia.thumb.url)} alt={tx('pos.full_screen_image')} style={{ height: 54, borderRadius: 6 }} />
                    <button className="btn ghost" onClick={() => fsFileRef.current?.click()} disabled={!!busy}>{busy === 'upload-fs' ? tx('pos.uploading') : tx('pos.replace')}</button>
                    <button className="btn ghost" onClick={() => { set('fullscreenMedia', null); setPreviewMode('panel'); }} disabled={!!busy}>{tx('pos.remove')}</button>
                  </div>
                ) : <button className="btn ghost" onClick={() => fsFileRef.current?.click()} disabled={!!busy}>{busy === 'upload-fs' ? tx('pos.uploading') : tx('pos.upload_full_screen_image')}</button>}
                <input ref={fsFileRef} type="file" accept={st.limits.allowedMimeTypes.join(',')} hidden onChange={(e) => upload(e, 'fullscreen')} />
              </section>
            ) : null}
          </div>

          <div className="dads-editor-preview">
            <div className="seg" style={{ marginBottom: 8 }}>
              <button className={'seg-btn' + (previewMode === 'panel' ? ' on' : '')} onClick={() => setPreviewMode('panel')}>{tx('pos.right_panel')}</button>
              {f.fullscreenMedia ? <button className={'seg-btn' + (previewMode === 'fullscreen' ? ' on' : '')} onClick={() => setPreviewMode('fullscreen')}>{tx('pos.full_screen_2')}</button> : null}
            </div>
            <DisplayPreview single={previewAd} mode={previewMode} salonName={salonName} />
            {!previewAd ? <div className="sub" style={{ marginTop: 8 }}>{tx('pos.upload_an_image_to_see_exactly_1wot')}</div> : null}
          </div>
        </div>
        {err ? (
          <div className="dads-err" role="alert">{err.msg}{err.conflict ? <> <button className="btn ghost" onClick={reload} disabled={!!busy}>{tx('pos.reload_latest')}</button></> : null}</div>
        ) : null}
        <div className="modal-f">
          <button className="btn" onClick={onClose} disabled={!!busy}>{tx('pos.cancel')}</button>
          <button className="btn" onClick={() => save(false)} disabled={!!busy || !f.name.trim()}>{busy === 'save' ? tx('pos.saving_2') : current ? tx('pos.save_changes') : tx('pos.save_as_draft')}</button>
          {!live ? <button className="btn primary" onClick={() => save(true)} disabled={!!busy || !f.name.trim() || !f.media}>{busy === 'publish' ? tx('pos.publishing') : current ? tx('pos.save_publish') : tx('pos.publish_now')}</button> : null}
        </div>
      </div>
    </div>
  );
}
