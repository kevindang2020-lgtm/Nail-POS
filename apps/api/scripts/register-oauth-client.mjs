#!/usr/bin/env node
// register-oauth-client.mjs — Constitution 3 Step 10d: the platform operator registers a partner app with the OAuth
// server. Partners are rare and each is a business decision, so this is a script, not a self-service screen.
//   DATABASE_URL=… node apps/api/scripts/register-oauth-client.mjs "Booking Widget Co" https://widget.example/callback \
//     [--scopes pos.booking.view,pos.services.view] [--confidential]
// Prints the client_id (and, for --confidential, the client secret ONCE — only its hash is stored).
import pg from 'pg';
import { createHash, randomBytes } from 'node:crypto';
const [name, redirect, ...rest] = process.argv.slice(2);
const flag = (f) => rest.includes(f); const opt = (f) => { const i = rest.indexOf(f); return i >= 0 ? rest[i + 1] : null; };
const ALLOWED = ['pos.booking.view', 'pos.customers.view', 'pos.services.view', 'pos.queue.view', 'pos.reports.view', 'pos.checkout.view'];
if (!name || !redirect || !/^https:\/\//.test(redirect) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(redirect)) {
  console.error('usage: register-oauth-client.mjs "<name>" <https redirect URI> [--scopes a,b] [--confidential]'); process.exit(2);
}
const scopes = (opt('--scopes') ?? 'pos.booking.view,pos.services.view').split(',').map((s) => s.trim()).filter((s) => ALLOWED.includes(s));
if (!scopes.length) { console.error(`no allowed scopes; choose from ${ALLOWED.join(', ')}`); process.exit(2); }
const clientId = 'app_' + randomBytes(12).toString('base64url');
const secret = flag('--confidential') ? 'ocs_' + randomBytes(32).toString('base64url') : null;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
await db.query('insert into oauth_clients (client_id, name, redirect_uris, client_secret_hash, allowed_scopes) values ($1, $2, $3, $4, $5)',
  [clientId, name, [redirect], secret ? createHash('sha256').update(secret).digest('hex') : null, scopes]);
await db.end();
console.log(JSON.stringify({ client_id: clientId, ...(secret ? { client_secret: secret } : {}), redirect_uri: redirect, scopes }, null, 2));
if (secret) console.error('Store the client_secret now — it is not shown again.');
