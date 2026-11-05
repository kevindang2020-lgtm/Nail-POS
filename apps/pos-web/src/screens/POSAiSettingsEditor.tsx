// POSAiSettingsEditor.tsx — Constitution 10 §52/§53/§110: the tenant actually CHANGING what AI may do,
// rather than only reading it.
//
// §110 is enforced on the server's write: a payload asking for more automation than the platform allows is
// REJECTED with the ceiling named, not stored and clamped. That makes two things this editor must get right:
//
//   1. It offers only levels at or below each task's ceiling. Offering a choice the server will refuse is a
//      worse experience than not offering it — the tenant picks, waits, and is told no.
//   2. It still surfaces the server's refusal verbatim if one arrives. The client list can go stale against a
//      ceiling that tightened since the page loaded, and in that race the SERVER is right. A client that
//      silently swallowed the 400 would leave the tenant believing a setting took effect.
//
// The kill switch is separate and always available: turning AI off is the tightening direction, which §53
// never restricts.
import { useCallback, useEffect, useState } from 'react';
import { posAiGovernanceApi as govApi, AUTOMATION_LEVELS, type AutomationLevel, type TenantAiSettingsPayload } from '../api/posAiGovernanceApi';
import { AUTOMATION_LABELS } from './POSAiGovernanceScreen';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

const LINE = 'var(--line,#E7DBC6)';
const MUTED = 'var(--muted,#7A6C57)';

/**
 * The levels a tenant may choose for this task: everything up to and including the platform ceiling.
 * Order comes from the server's own list, which IS the comparison order — index equals strictness.
 */
export function selectableLevels(platformMax: AutomationLevel, levels: readonly AutomationLevel[] = AUTOMATION_LEVELS): AutomationLevel[] {
  const cap = levels.indexOf(platformMax);
  if (cap < 0) return [levels[0]];        // an unknown ceiling means offer only the safest level, never all of them
  return levels.slice(0, cap + 1);
}

export function POSAiSettingsEditor() {
  const [data, setData] = useState<TenantAiSettingsPayload | null>(null);
  const [draft, setDraft] = useState<Record<string, AutomationLevel>>({});
  const [killSwitch, setKillSwitch] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await govApi.getSettings();
      setData(d);
      setDraft({ ...(d.settings?.automation ?? {}) });
      setKillSwitch(Boolean(d.settings?.killSwitch));
    } catch (e: any) {
      setData(null);
      setError(e?.message || tx('pos.could_not_load_ai_settings'));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async () => {
    setBusy(true); setError(null); setSaved(false);
    try {
      await govApi.saveSettings({ automation: draft, killSwitch });
      setSaved(true);
    } catch (e: any) {
      // The server's own words. §110 refusals name the task and its ceiling; paraphrasing would lose that.
      setError(e?.message || tx('pos.those_settings_were_not_saved'));
    } finally {
      setBusy(false);
    }
  }, [draft, killSwitch]);

  if (error && !data) return <div style={{ padding: 20 }}><h1>{tx('pos.ai_settings')}</h1><p style={{ color: MUTED }}>{error}</p></div>;
  if (!data) return <div style={{ padding: 20 }}><h1>{tx('pos.ai_settings')}</h1><p style={{ color: MUTED }}>{tx('pos.loading')}</p></div>;

  const levels = data.levels?.length ? data.levels : AUTOMATION_LEVELS;

  return (
    <div style={{ padding: 20, display: 'grid', gap: 16 }}>
      <header>
        <h1 style={{ margin: 0 }}>{tx('pos.ai_settings')}</h1>
        <p style={{ color: MUTED, margin: '4px 0 0' }}>
          {tx('pos.each_task_can_be_set_no_134l')}
        </p>
      </header>

      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={killSwitch} onChange={(e) => { setKillSwitch(e.target.checked); setSaved(false); }} />
        <span>{tx('pos.turn_off_all_ai_in_this_tfag')}</span>
      </label>

      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr style={{ textAlign: 'left', color: MUTED, fontSize: 12 }}>
            <th style={{ padding: '4px 8px 4px 0' }}>{tx('pos.task')}</th>
            <th style={{ padding: '4px 8px' }}>{tx('pos.may')}</th>
            <th style={{ padding: '4px 8px' }}>{tx('pos.platform_limit')}</th>
          </tr>
        </thead>
        <tbody>
          {data.tasks.map((t) => {
            const options = selectableLevels(t.platformMax, levels);
            const current = draft[t.taskKey] ?? options[0];
            return (
              <tr key={t.taskKey} style={{ borderTop: `1px solid ${LINE}` }}>
                <td style={{ padding: '6px 8px 6px 0' }}>{t.taskKey}</td>
                <td style={{ padding: '6px 8px' }}>
                  <select
                    aria-label={tx('pos.automation_level_for_taskkey', { taskKey: String(t.taskKey) })}
                    value={current}
                    disabled={killSwitch}
                    onChange={(e) => { setDraft((d) => ({ ...d, [t.taskKey]: e.target.value as AutomationLevel })); setSaved(false); }}
                  >
                    {options.map((l) => <option key={l} value={l}>{AUTOMATION_LABELS[l] ?? l}</option>)}
                  </select>
                </td>
                <td style={{ padding: '6px 8px', color: MUTED }}>{AUTOMATION_LABELS[t.platformMax] ?? t.platformMax}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button type="button" onClick={() => void save()} disabled={busy}>{busy ? tx('pos.saving_2') : tx('pos.save_ai_settings')}</button>
        {saved && <span style={{ color: MUTED }}>{tx('pos.saved_2')}</span>}
        {/* A refusal must stay visible next to the control that caused it. */}
        {error && <span role="alert" style={{ color: 'var(--danger,#9B2C2C)' }}>{error}</span>}
      </div>
    </div>
  );
}
