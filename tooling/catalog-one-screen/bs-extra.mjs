// bs-extra.mjs — AI Center → Business Setup in the catalog harness (AI Business Setup guide, Oct 30 2026, migration 753).
// The REAL BusinessSetupCenterController → BusinessSetupCenter → SQL on the seeded TEST database. Tooling only — never shipped.
// Nothing leaves the machine: Preview never books, holds, texts or calls; no voice provider is contacted.
// Controls (GET /__bs?…): reset=1 → this section's FAQ rows / preview runs removed and the store-hours row restored ·
// seed=1 → 23 draft FAQs for paging + one approved FAQ + saved branch store hours · state=1 → DB truth by INDEPENDENT SQL
// (the AI eligibility rules written out here, not read from the center) · nohours=1 → store-hours rows removed.
import { BusinessSetupCenter } from '../../modules/ai/src/voice-booking/business-setup-center.ts';
import { BusinessSetupCenterController } from '../../modules/ai/src/voice-booking/business-setup-center.controller.ts';

export function bsExtra(db, pg) {
  const bc = new BusinessSetupCenter(db);
  const ctl = new BusinessSetupCenterController(bc);
  const q = (s, p = []) => pg.query(s, p);
  let savedHours = null;
  return {
    routes: (routesOf) => routesOf('modules/ai/src/voice-booking/business-setup-center.controller.ts', '/pos/ai/business-setup', ctl),
    async control(sp, T, B) {
      if (sp.get('reset')) {
        await q(`set session_replication_role = replica`);   // revisions / events are append-only by trigger — the harness reset only
        try {
          await q(`delete from ai_receptionist_faq_events where tenant_id = $1`, [T]);
          await q(`delete from ai_receptionist_faq_revisions where tenant_id = $1`, [T]);
        } finally { await q(`set session_replication_role = origin`); }
        await q(`delete from ai_receptionist_faqs where tenant_id = $1`, [T]);
        await q(`delete from ai_business_setup_preview_runs where tenant_id = $1`, [T]);
        if (savedHours) { await q(`delete from tenant_settings where tenant_id = $1 and category = 'store-hours-auto-logout'`, [T]); for (const r of savedHours) await q(`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values ($1, $2, 'store-hours-auto-logout', $3::jsonb)`, [T, r.branch_id, JSON.stringify(r.settings_json)]); savedHours = null; }
        return { reset: true };
      }
      if (sp.get('nohours')) {
        savedHours = savedHours ?? (await q(`select branch_id, settings_json from tenant_settings where tenant_id = $1 and category = 'store-hours-auto-logout'`, [T])).rows;
        await q(`delete from tenant_settings where tenant_id = $1 and category in ('store-hours-auto-logout', 'store_hours')`, [T]);
        return { hoursRemoved: true };
      }
      if (sp.get('seed')) {
        savedHours = savedHours ?? (await q(`select branch_id, settings_json from tenant_settings where tenant_id = $1 and category = 'store-hours-auto-logout'`, [T])).rows;
        const week = { monday: { isOpen: true, openTime: '09:00', closeTime: '19:00' }, tuesday: { isOpen: true, openTime: '09:00', closeTime: '19:00' }, wednesday: { isOpen: true, openTime: '09:00', closeTime: '19:00' },
          thursday: { isOpen: true, openTime: '09:00', closeTime: '19:00' }, friday: { isOpen: true, openTime: '09:00', closeTime: '20:00' }, saturday: { isOpen: true, openTime: '09:00', closeTime: '18:00' }, sunday: { isOpen: true, openTime: '11:00', closeTime: '17:00' } };
        await q(`delete from tenant_settings where tenant_id = $1 and branch_id = $2 and category = 'store-hours-auto-logout'`, [T, B]);
        await q(`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values ($1, $2, 'store-hours-auto-logout', $3::jsonb)`, [T, B, JSON.stringify({ storeHours: week })]);
        const ctx = { tenantId: T, branchId: B, userId: '00000000-0000-4000-8000-0000000000aa', role: 'OWNER', permissions: ['ai.use', 'ai.manage'] };
        for (let i = 1; i <= 23; i++) await bc.createFaq(ctx, { question: i === 1 ? 'Needle oldest question about parking' : `Seeded question ${i}`, answer: i % 2 ? 'Free parking behind the salon.' : 'We accept cards and cash.', category: i % 2 ? 'Parking' : 'Payment', idempotencyKey: `bs-seed-${String(i).padStart(4, '0')}` });
        await q(`update ai_receptionist_faqs set created_at = now() - (interval '1 hour' * (100 - coalesce(nullif(regexp_replace(question, '\\D', '', 'g'), '')::int, 1))) where tenant_id = $1`, [T]);
        const w = await bc.createFaq(ctx, { question: 'Do you take walk-ins?', answer: 'Yes, when a technician is free.', category: 'General', idempotencyKey: 'bs-seed-walkins-0001' });
        await bc.faqAction(ctx, w.id, { action: 'approve', expectedVersion: 1, idempotencyKey: 'bs-seed-approve-0001' });
        return { seeded: 24 };
      }
      if (sp.get('state')) {
        // independent of BusinessSetupCenter: the AI eligibility written out here (tenant + branch-or-none + active)
        const r = (await q(`select
            (select count(*) from services where tenant_id = $1)::int as svc_raw,
            (select count(*) from services where tenant_id = $1 and status = 'active' and (branch_id = $2 or branch_id is null))::int as svc_eligible,
            (select count(*) from technicians where tenant_id = $1)::int as tech_raw,
            (select count(*) from technicians where tenant_id = $1 and is_active and (branch_id = $2 or branch_id is null))::int as tech_eligible,
            (select count(*) from ai_receptionist_faqs where tenant_id = $1)::int as faqs,
            (select count(*) from ai_receptionist_faqs where tenant_id = $1 and status = 'approved')::int as approved,
            (select count(*) from ai_business_setup_preview_runs where tenant_id = $1)::int as previews,
            (select count(*) from appointment_schedule_locks)::int as locks,
            (select count(*) from notifications where tenant_id = $1)::int as notifications`, [T, B])).rows[0];
        return r;
      }
      return { ok: true };
    },
  };
}
