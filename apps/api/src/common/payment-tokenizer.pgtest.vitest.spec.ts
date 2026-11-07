// payment-tokenizer.pgtest — the customer app's add-card form is the salon's CardSecure hosted iFrame tokenizer, derived
// from the salon's OWN gateway host (tenant_payment_config.base_url). Only a cardconnect.com https host qualifies; no
// credential is involved or returned.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { PaymentGatewayResolver } from '@aipowersalon/payments';

const A = '25252525-2525-4252-8252-252525252525', B = '26262626-2626-4262-8262-262626262626', C = '27272727-2727-4272-8272-272727272727';
let resolver: PaymentGatewayResolver;

beforeAll(async () => {
  const pg = await migratedPglite();
  for (const [id, slug] of [[A, 'toka'], [B, 'tokb'], [C, 'tokc']]) {
    await pg.query(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ($1,'T','T',$2,$3,'active') ON CONFLICT (id) DO NOTHING`, [id, slug, slug.toUpperCase()]);
  }
  await pg.query(`INSERT INTO tenant_payment_config (tenant_id, processor, environment, base_url, merchant_id, api_username_enc, api_password_enc, status) VALUES ($1,'fiserv','sandbox','https://isv-uat.cardconnect.com/cardconnect/rest','MID-A','u','p','active')`, [A]);
  await pg.query(`INSERT INTO tenant_payment_config (tenant_id, processor, environment, base_url, merchant_id, api_username_enc, api_password_enc, status) VALUES ($1,'fiserv','sandbox','https://attacker.example/cardconnect/rest','MID-B','u','p','active')`, [B]);
  resolver = new PaymentGatewayResolver(kyselyFor(pg) as any, { encrypt: (s: string) => s, decrypt: (s: string) => s } as any);
});

describe("the salon's hosted card tokenizer URL", () => {
  it('is built from the gateway host: https://<site>.cardconnect.com/itoke/ajax-tokenizer.html with expiry + CVV', async () => {
    const r = await resolver.tokenizerUrl(A);
    expect(r.available).toBe(true);
    expect(r.origin).toBe('https://isv-uat.cardconnect.com');
    expect(r.url).toMatch(/^https:\/\/isv-uat\.cardconnect\.com\/itoke\/ajax-tokenizer\.html\?/);
    expect(r.url).toContain('useexpiry=true');
    expect(r.url).toContain('usecvv=true');
    expect(JSON.stringify(r)).not.toContain('MID-A');
  });
  it('refuses a gateway host that is not cardconnect.com (the iframe must be the gateway\'s own page)', async () => {
    // Fiserv §5.3: the same host allowlist as a charge refuses it before any tokenizer URL is built
    expect(await resolver.tokenizerUrl(B)).toEqual({ available: false, reason: 'host_not_allowlisted' });
  });
  it('is unavailable when the salon has no gateway', async () => {
    expect(await resolver.tokenizerUrl(C)).toEqual({ available: false, reason: 'gateway_not_configured' });
  });
});
