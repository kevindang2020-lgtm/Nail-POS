import { describe, it, expect } from 'vitest';
import { SuperAdminPlatformService } from './super-admin-platform.service';
import { InMemorySuperAdminPlatformRepo } from './super-admin-platform.repository';

// POST /public/website/applications → SuperAdminPlatformService.publicCreateApplication → tenant_applications.
// CONTRACT CHANGE (Jul 25, 2026, per the Free POS Package intake spec): first/last (or legacy ownerName), salon,
// EMAIL AND PHONE, and the consent checkbox are all required; the public response returns a reference number and
// never an internal id; EIN is validated + stored encrypted with last-4 for masking; idempotent re-submission
// returns the same reference; duplicates are FLAGGED (score + reasons) — never silently discarded, never revealed
// to the applicant. Earlier looser-contract tests were updated to this contract, none deleted.
function svc() {
  const repo = new InMemorySuperAdminPlatformRepo();
  return { repo, s: new SuperAdminPlatformService(repo) };
}
const base = {
  owner_first_name: 'Linda', owner_last_name: 'Pham', salon_name: 'Lotus Nail Bar',
  phone: '609-555-0188', email: 'linda@lotus.com', sms_email_consent: true,
};

describe('Public website intake — tenant application (spec contract)', () => {
  it('maps the full form, returns a public reference (never the internal id), stores consent evidence + normalized fields', async () => {
    const { repo, s } = svc();
    const out = await s.publicCreateApplication({
      ...base, address: '45 Haddon Ave', city: 'Collingswood', state: 'NJ', zip: '08108',
      technician_count: '6', location_count: '1', ein: '12-3456789', referral_source: 'Google search',
      current_pos: 'Clover', current_payment_processor: 'Fiserv', average_monthly_card_volume: '$25k–$50k',
      best_time_to_contact: 'Morning', preferred_contact_method: 'Text message',
      message: 'Two locations soon.', interested_hardware: ['ASUS V470', 'Clover Compact'],
      form_version: '2026-07-25', utm: { utm_source: 'google', utm_campaign: 'launch' },
    }, '9.9.9.9', 'Mozilla/5.0 test');
    expect(out.ok).toBe(true);
    expect(String(out.reference)).toMatch(/^APS-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect((out as any).id).toBeUndefined();
    const a = (repo as any).apps[0];
    expect(a.owner_name).toBe('Linda Pham');
    expect(a.owner_first_name).toBe('Linda'); expect(a.owner_last_name).toBe('Pham');
    expect(a.consent_given).toBe(true); expect(a.consent_text).toContain('agree to be contacted'); expect(a.consent_at).toBeTruthy();
    expect(a.ip_address).toBe('9.9.9.9'); expect(a.user_agent).toContain('Mozilla');
    expect(a.card_volume_band).toBe('$25k–$50k'); expect(a.best_contact_time).toBe('Morning');
    expect(a.locations_count).toBe(1); expect(a.technicians_count).toBe(6);
    expect(JSON.parse(a.utm)).toEqual({ utm_source: 'google', utm_campaign: 'launch' });
    expect(a.notes[0].text).toContain('Interested hardware: ASUS V470, Clover Compact');
    expect(a.status).toBe('new');
  });

  it('EIN: validated (9 digits), NEVER stored raw — last-4 kept for masking; encrypted only when a key is configured', async () => {
    const { repo, s } = svc();
    await s.publicCreateApplication({ ...base, ein: '98-7654321' }, '9.9.9.8');
    const a = (repo as any).apps[0];
    expect(a.ein_last4).toBe('4321');
    expect(a.ein_encrypted ?? null).toBeNull(); // no APP_DATA_ENCRYPTION_KEY in tests → honest null, still no raw EIN anywhere
    expect(JSON.stringify(a)).not.toContain('98-7654321');
    expect(JSON.stringify(a)).not.toContain('987654321');
    await expect(s.publicCreateApplication({ ...base, email: 'x@x.com', ein: '12-345' }, '9.9.9.7')).rejects.toThrow(/EIN/);
  });

  it('EIN is encrypted at rest when APP_DATA_ENCRYPTION_KEY is set (AES-256-GCM, decrypts back)', async () => {
    process.env.APP_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    try {
      const { repo, s } = svc();
      await s.publicCreateApplication({ ...base, ein: '12-3456789' }, '9.9.9.6');
      const a = (repo as any).apps[0];
      expect(a.ein_encrypted).toMatch(/^v1:/);
      expect(a.ein_encrypted).not.toContain('3456789');
      const { decryptField } = await import('./field-encryption');
      expect(decryptField(a.ein_encrypted)).toBe('12-3456789');
    } finally { delete process.env.APP_DATA_ENCRYPTION_KEY; }
  });

  it('required-field contract: consent, email AND phone, owner + salon names', async () => {
    const { s } = svc();
    await expect(s.publicCreateApplication({ ...base, sms_email_consent: false }, '2.2.2.1')).rejects.toThrow(/Consent/);
    await expect(s.publicCreateApplication({ ...base, email: '' }, '2.2.2.2')).rejects.toThrow(/email/);
    await expect(s.publicCreateApplication({ ...base, phone: '1' }, '2.2.2.3')).rejects.toThrow(/phone/);
    await expect(s.publicCreateApplication({ ...base, owner_first_name: '', owner_last_name: '' }, '2.2.2.4')).rejects.toThrow(/Owner name/);
    await expect(s.publicCreateApplication({ ...base, salon_name: 'X' }, '2.2.2.5')).rejects.toThrow(/Salon name/);
    await expect(s.publicCreateApplication({ ...base, zip: 'abcde' }, '2.2.2.6')).rejects.toThrow(/ZIP/);
    // legacy single ownerName shape still accepted (older embeds)
    const ok = await s.publicCreateApplication({ ownerName: 'Pat Lee', salon_name: 'Bare Salon', email: 'p@l.com', phone: '6095550000', sms_email_consent: true }, '3.3.3.3');
    expect(ok.ok).toBe(true);
  });

  it('honeypot (either field name) accepts-and-drops: ok response, nothing stored', async () => {
    const { repo, s } = svc();
    const a = await s.publicCreateApplication({ ...base, website: 'http://spam.example' }, '1.1.1.1');
    const b = await s.publicCreateApplication({ ...base, company_website: 'http://spam.example' }, '1.1.1.2');
    expect(a).toEqual({ ok: true }); expect(b).toEqual({ ok: true });
    expect((repo as any).apps.length).toBe(0);
  });

  it('idempotency: re-sending the same key returns the SAME reference and creates no second record', async () => {
    const { repo, s } = svc();
    const k = 'idem-abc-123';
    const first = await s.publicCreateApplication({ ...base, idempotency_key: k }, '4.4.4.4');
    const again = await s.publicCreateApplication({ ...base, idempotency_key: k }, '4.4.4.4');
    expect(again.reference).toBe(first.reference);
    expect((repo as any).apps.length).toBe(1);
  });

  it('duplicates are flagged with reasons + score, still saved as new, and the response reveals nothing', async () => {
    const { repo, s } = svc();
    await s.publicCreateApplication({ ...base }, '5.5.5.1');
    const out = await s.publicCreateApplication({ ...base, salon_name: 'Lotus Nail Bar', ein: '12-3456789' }, '5.5.5.2');
    expect(out.ok).toBe(true); expect(String(out.reference)).toMatch(/^APS-/);
    const dup = (repo as any).apps[0];
    expect(dup.status).toBe('new');
    expect(dup.duplicate_risk_score).toBeGreaterThan(0);
    const reasons = JSON.parse(dup.duplicate_reasons);
    expect(reasons.some((r: string) => r.includes('Same email'))).toBe(true);
    expect(reasons.some((r: string) => r.includes('Same salon name'))).toBe(true);
    expect(JSON.stringify(out)).not.toMatch(/duplicate|exists|already/i);
  });

  it('fraud signals: disposable email, suspicious phone, IP velocity, and existing-tenant match are FLAGGED (never rejected)', async () => {
    const { repo, s } = svc();
    (repo as any).tenantEmails = ['owner@existing-salon.com'];
    // three prior submissions from the same IP within 24h
    for (let i = 0; i < 3; i++) await s.publicCreateApplication({ ...base, email: `v${i}@x.com`, phone: `60955502${(10 + i)}`, salon_name: `V${i}` }, '6.6.6.6');
    const out = await s.publicCreateApplication({
      ...base, email: 'owner@existing-salon.com', phone: '1234567890', salon_name: 'Flag Me',
    }, '6.6.6.6');
    expect(out.ok).toBe(true); // saved, not blocked
    const a = (repo as any).apps[0];
    expect(a.status).toBe('new');
    expect(a.spam_score).toBeGreaterThan(0);
    const reasons = JSON.parse(a.duplicate_reasons);
    expect(reasons.some((r: string) => r.includes('Suspicious phone'))).toBe(true);
    expect(reasons.some((r: string) => r.includes('submission velocity'))).toBe(true);
    expect(reasons.some((r: string) => r.includes('existing tenant'))).toBe(true);
    expect(JSON.stringify(out)).not.toMatch(/spam|velocity|tenant|disposable/i); // nothing revealed to the applicant
  });

  it('disposable email domains are flagged with the domain named', async () => {
    const { repo, s } = svc();
    await s.publicCreateApplication({ ...base, email: 'bot@mailinator.com' }, '6.6.6.7');
    const a = (repo as any).apps[0];
    expect(a.spam_score).toBe(25);
    expect(JSON.parse(a.duplicate_reasons).some((r: string) => r.includes('mailinator.com'))).toBe(true);
  });

  it('rate limiting still gates repeated submissions from one IP', async () => {
    const { s } = svc();
    let limited = false;
    for (let i = 0; i < 12; i++) {
      try { await s.publicCreateApplication({ ...base, email: `u${i}@x.com`, phone: `60955501${(10 + i)}` }, '7.7.7.7'); }
      catch { limited = true; break; }
    }
    expect(limited).toBe(true);
  });
});

const reasonsFor = async (repo: any, email: string) => { const r = (await repo.applications({})).rows; return String(r.find((x: any) => x.email === email)?.duplicate_reasons || ''); };
describe('fraud signals: links in message + state↔ZIP mismatch (Jul 29 — the two deferred at the Jul-26 build)', () => {
  const svc2 = () => svc();
  it('a link in the free-text message is flagged by domain — and the application still saves as new', async () => {
    const { repo, s } = svc2();
    await s.publicCreateApplication({ ...base, state: 'NJ', zip: '08108', message: 'see https://cheap-seo-offers.biz/deal and www.spamsite.io now' }, '7.7.7.1');
    const rows = (await repo.applications({} as any)).rows;
    const row = rows[rows.length - 1];
    expect(row.status).toBe('new');                                        // flagged, never blocked
    const reasons = String(row.duplicate_reasons || '');
    expect(reasons).toContain('Message contains link(s): cheap-seo-offers.biz, spamsite.io');
  });
  it('a ZIP outside the stated state flags; a matching pair and an unknown state format never do', async () => {
    const { repo, s } = svc2();
    await s.publicCreateApplication({ ...base, state: 'NJ', zip: '90210' }, '7.7.7.2');   // CA zip, NJ state
    expect(await reasonsFor(repo, base.email)).toContain('ZIP 90210 does not appear to match state NJ');
    await s.publicCreateApplication({ ...base, email: 'ok2@example.com', phone: '8562221001', state: 'NJ', zip: '08108' }, '7.7.7.3');
    expect(await reasonsFor(repo, 'ok2@example.com')).not.toContain('does not appear to match');
    await s.publicCreateApplication({ ...base, email: 'ok3@example.com', phone: '8562221002', state: 'New Jersey', zip: '90210' }, '7.7.7.4');
    expect(await reasonsFor(repo, 'ok3@example.com')).not.toContain('does not appear to match'); // unknown format never flags
  });
});
