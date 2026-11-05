// POSSocialScreen.tsx — Marketing → Social. A social content planner over the real /pos/social-posts slice:
// draft/schedule posts, see them on a status board, and move them draft -> scheduled -> posted -> archived.
// It is a PLANNING/TRACKING tool — it does not publish to Instagram/Facebook/etc. Marking a post "posted" is
// something you do after you publish it yourself. All data is real; empty until you add posts.
import { useCallback, useEffect, useState } from 'react';
import { displayLocale } from '../i18n/format';
import { posSocialApi } from '../api/posSocialApi';
import { reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';
// the success note is a sentinel, worded at render in the cashier's language (Vietnamese POS mandate §59)
const NOTE_OK = '\u0000ok';

type Post = { id: string; platform: string; caption: string; scheduledAt: string | null; status: string; postedAt: string | null; createdAt: string };
type Kpis = { drafts: number; scheduled: number; posted: number; total: number };
const PLATFORMS = ['instagram', 'facebook', 'tiktok', 'other'];
const platformLabel = (p: string) => p === 'tiktok' ? 'TikTok' : p.charAt(0).toUpperCase() + p.slice(1);
const statusChip = (s: string) => {
  const map: Record<string, string> = { draft: '#9A6a2a', scheduled: '#2D6CBF', posted: '#2E9E54', archived: '#9A9A9A' };
  return <span style={{ color: map[s] ?? '#666', fontWeight: 700, fontSize: 12, textTransform: 'capitalize' }}>{s}</span>;
};
const nextActions = (s: string): { to: string; label: string }[] => {
  if (s === 'draft') return [{ to: 'scheduled', label: t('pos.schedule') }, { to: 'posted', label: t('pos.mark_posted') }];
  if (s === 'scheduled') return [{ to: 'posted', label: t('pos.mark_posted') }, { to: 'draft', label: t('pos.back_to_draft') }];
  if (s === 'posted') return [{ to: 'archived', label: t('pos.archive') }];
  return [];
};
const fmt = (iso: string | null) => { if (!iso) return '—'; try { return new Date(iso).toLocaleDateString(displayLocale(), { month: 'short', day: '2-digit' }); } catch { return iso; } };

export function POSSocialScreen() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [platform, setPlatform] = useState('instagram');
  const [caption, setCaption] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const s = await posSocialApi.state(); setKpis(s.kpis); setPosts(s.posts ?? []); }
    catch (e: any) { setError(reportError(e, t('admin.noun.socialPlanner'))); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!caption.trim()) { setNote(t('pos.write_a_caption_first')); return; }
    setSaving(true); setNote(null);
    try { await posSocialApi.create({ platform, caption: caption.trim(), scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null }); setCaption(''); setScheduledAt(''); setNote(NOTE_OK); await load(); }
    catch (e: any) { setNote(e?.message || t('pos.could_not_add_the_post')); }
    finally { setSaving(false); }
  };
  const move = async (id: string, to: string) => {
    setNote(null);
    try { await posSocialApi.setStatus(id, to); await load(); }
    catch (e: any) { setNote(e?.message || t('pos.could_not_update')); }
  };

  if (loading) return <div className="work"><div className="state">{t('pos.loading_planner')}</div></div>;
  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;

  return (
    <div className="work">
      <div className="vh" style={{ marginBottom: 10 }}><h1>{t('pos.social_planner')}</h1><div className="sub">{t('pos.plan_and_track_your_social_posts')}</div></div>

      {kpis ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4  gap-3 mb-4">
          <div className="panel" style={{ padding: '16px' }}><div className="sub" style={{ fontSize: 12 }}>{t('pos.drafts')}</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{kpis.drafts}</div></div>
          <div className="panel" style={{ padding: '16px' }}><div className="sub" style={{ fontSize: 12 }}>{t('pos.scheduled')}</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 4, color: '#2D6CBF' }}>{kpis.scheduled}</div></div>
          <div className="panel" style={{ padding: '16px' }}><div className="sub" style={{ fontSize: 12 }}>{t('pos.posted')}</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 4, color: '#2E9E54' }}>{kpis.posted}</div></div>
          <div className="panel" style={{ padding: '16px' }}><div className="sub" style={{ fontSize: 12 }}>{t('pos.active_posts')}</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{kpis.total}</div></div>
        </div>
      ) : null}

      <section className="panel" style={{ marginTop: 12, maxWidth: 640 }}>
        <div className="p-h">{t('pos.new_post')}</div>
        <div className="flex flex-col gap-0 mt-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="lf">
              <label>{t('pos.platform')}</label>
              <select value={platform} onChange={(e) => setPlatform(e.target.value)} style={{ width: '100%' }}>
                {PLATFORMS.map((p) => <option key={p} value={p}>{platformLabel(p)}</option>)}
              </select>
            </div>
            <div className="lf">
              <label>{t('pos.schedule_for_optional')}</label>
              <input type="date" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} style={{ width: '100%' }} />
            </div>
          </div>
          <div className="lf" style={{ alignItems: 'flex-start' }}>
            <label style={{ marginTop: 10 }}>{t('pos.caption')}</label>
            <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={3} placeholder={t('pos.what_s_the_post_about')} style={{ width: '100%', resize: 'vertical' }} />
          </div>
          <div className="mt-4 pt-4 flex items-center gap-3" style={{ borderTop: '1px solid var(--line)' }}>
            <button className="btn primary" disabled={saving} onClick={create}>{saving ? t('pos.adding') : t('pos.add_to_planner')}</button>
            {note ? <span className="sub" role="status" style={{ color: note === NOTE_OK ? '#2E9E54' : '#C0392B', fontSize: 13 }}>{note === NOTE_OK ? t('pos.added') : note}</span> : null}
          </div>
        </div>
      </section>

      <section className="panel" style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
        <div className="p-h" style={{ padding: '14px 14px 0' }}>{t('pos.content_calendar')}</div>
        {posts.length === 0 ? <div className="state" style={{ padding: 16 }}>{t('pos.no_posts_planned_yet')}</div> : (
          <div className="overflow-x-auto">
            <div className="min-w-[700px]">
              <table className="tbl">
                <thead><tr><th>{t('pos.platform')}</th><th>{t('pos.caption')}</th><th>{t('pos.scheduled')}</th><th>{t('pos.status')}</th><th></th></tr></thead>
                <tbody>{posts.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 700 }}>{platformLabel(p.platform)}</td>
                    <td style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.caption}</td>
                    <td className="sub" style={{ fontSize: 12.5 }}>{fmt(p.scheduledAt)}</td>
                    <td>{statusChip(p.status)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {nextActions(p.status).map((a) => (
                        <button key={a.to} className="btn ghost" style={{ marginLeft: 6 }} onClick={() => move(p.id, a.to)}>{a.label}</button>
                      ))}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}
      </section>
      <div className="sub" style={{ fontSize: 12, marginTop: 10, maxWidth: 640, lineHeight: 1.6 }}>
        {t('pos.this_is_a_content_planner_it_12lw')}
      </div>
    </div>
  );
}
