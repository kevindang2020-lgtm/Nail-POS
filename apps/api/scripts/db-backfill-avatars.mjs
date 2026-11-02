#!/usr/bin/env node
// db-backfill-avatars.mjs — B-18 (Oct 22 2026): owner / staff avatars that predate the media store sit in Postgres as
// data URLs (user_avatars.data_url, sometimes users.avatar_url). New uploads have written a media KEY since Phase 12;
// this moves the old rows: decode → the one upload policy's key (tenants/<t>/avatars/staff/<user>/<random>.<ext>) → the
// configured media store → the row points at the key. Idempotent (a row already holding a key is skipped); --dry-run
// counts only. Run once per environment after deploy, with the API's MEDIA_* variables in the shell:
//
//   DATABASE_URL=… MEDIA_STORE=s3 MEDIA_S3_BUCKET=… node apps/api/scripts/db-backfill-avatars.mjs [--dry-run] [--limit N]
//
// Needs the packages built (it loads @aipowersalon/media from dist). Nothing is deleted: a row that fails to move keeps
// its data URL (buildMediaUrl renders it as itself) and is listed at the end.
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const media = require('@aipowersalon/media');
const dry = process.argv.includes('--dry-run');
const limitArg = process.argv.indexOf('--limit');
const limit = limitArg > 0 ? Math.max(1, Number(process.argv[limitArg + 1]) || 500) : 500;
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is required'); process.exit(2); }

const SNIFF = [[/^\xff\xd8\xff/, 'jpg'], [/^\x89PNG/, 'png'], [/^GIF8/, 'gif'], [/^RIFF....WEBP/s, 'webp']];
function extOf(buf, declared) {
  const head = buf.subarray(0, 16).toString('latin1');
  for (const [re, ext] of SNIFF) if (re.test(head)) return ext;
  const d = String(declared || '').toLowerCase();
  return d === 'jpeg' ? 'jpg' : /^[a-z0-9]{2,5}$/.test(d) ? d : null;
}

const client = new pg.Client({ connectionString: url });
await client.connect();
const store = media.makeMediaStorage();
const rows = (await client.query(`SELECT tenant_id, user_id, data_url FROM user_avatars WHERE data_url LIKE 'data:image/%' ORDER BY updated_at LIMIT $1`, [limit])).rows;
const legacyUsers = (await client.query(`SELECT id, tenant_id, avatar_url FROM users WHERE avatar_url LIKE 'data:image/%' LIMIT $1`, [limit])).rows;
console.log(`avatars as data URLs: user_avatars ${rows.length}, users.avatar_url ${legacyUsers.length}${dry ? ' (dry run)' : ''}`);
const failed = []; let moved = 0;
async function move(tenantId, userId, dataUrl) {
  const comma = dataUrl.indexOf(',');
  const declared = dataUrl.slice(11, dataUrl.indexOf(';') > 0 ? dataUrl.indexOf(';') : comma);
  const buf = Buffer.from(dataUrl.slice(comma + 1).replace(/\s/g, ''), 'base64');
  const ext = extOf(buf, declared);
  if (!ext || !buf.length || buf.length > 5 * 1024 * 1024) throw new Error(`not a usable image (${buf.length} bytes, ${declared})`);
  const key = media.uploadObjectKey({ tenantId, area: 'avatars', owner: ['staff', userId], ext });
  if (!dry) await store.put(key, buf);
  return key;
}
for (const r of rows) {
  try {
    const key = await move(String(r.tenant_id), String(r.user_id), String(r.data_url));
    if (!dry) {
      await client.query(`UPDATE user_avatars SET data_url = $3, updated_at = now() WHERE tenant_id = $1 AND user_id = $2`, [r.tenant_id, r.user_id, key]);
      await client.query(`UPDATE users SET avatar_url = $2, updated_at = now() WHERE id = $1 AND (avatar_url IS NULL OR avatar_url LIKE 'data:image/%')`, [r.user_id, key]);
    }
    moved++;
  } catch (e) { failed.push({ userId: String(r.user_id), error: String(e?.message || e) }); }
}
for (const u of legacyUsers) {
  if (rows.some((r) => String(r.user_id) === String(u.id))) continue;   // handled above
  try {
    const key = await move(String(u.tenant_id), String(u.id), String(u.avatar_url));
    if (!dry) await client.query(`UPDATE users SET avatar_url = $2, updated_at = now() WHERE id = $1`, [u.id, key]);
    moved++;
  } catch (e) { failed.push({ userId: String(u.id), error: String(e?.message || e) }); }
}
await client.end();
console.log(`${dry ? 'would move' : 'moved'} ${moved} avatar(s) into the media store; ${failed.length} kept as data URLs`);
for (const f of failed) console.log(`  kept ${f.userId}: ${f.error}`);
process.exit(0);
