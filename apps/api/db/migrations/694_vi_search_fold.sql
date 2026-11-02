-- migrate: no-transaction
-- 694_vi_search_fold.sql — Vietnamese POS mandate WP-E (§40–§42): accent-insensitive search. "nguyen" finds "Nguyễn",
-- "dang" finds "Đặng", and an accented query still finds the accented name. Stored names are NEVER changed (§42): the fold
-- is only a search key, computed in the index and in the WHERE clause.
--
-- vi_fold(text) is the SQL twin of foldVi() in packages/api-contracts/src/text/vi-fold.ts (the same key on both sides;
-- apps/api/src/pos/vi-search.pgtest.vitest.spec.ts proves foldVi(s) = vi_fold(s) over the whole Vietnamese alphabet and
-- every Latin letter with a diacritic in U+00C0–U+024F / U+1E00–U+1EFF):
--   translate()  every precomposed letter whose NFD base is A–Z/a–z → that base letter, Đ/đ → D/d (NFD leaves đ alone,
--                so a plain "strip combining marks" would not fold it), and every stray combining mark U+0300–U+036F is
--                DELETED (translate drops a from-character with no to-character) so a name stored decomposed (NFD,
--                as some macOS / iOS keyboards send it) folds the same as its precomposed form;
--   lower()      after translate only ASCII letters remain to lower-case, so the result does not depend on the
--                database's ctype; then whitespace runs collapse to one space and the ends are trimmed.
-- Why not the unaccent extension: no migration uses it, it is not guaranteed installable on the production host, its
-- unaccent() is STABLE (it reads a dictionary) so it cannot back an index, and its default rules leave nothing to prove
-- parity against. translate/lower/regexp_replace/btrim are all IMMUTABLE built-ins, so vi_fold is too.
-- The body is a single-quoted string (no dollar quoting) because this file runs outside a transaction, one statement at a time
-- (migration-sql.mjs refuses dollar-quoted bodies here); CREATE OR REPLACE keeps the statement idempotent for a re-run. Not STRICT,
-- so the planner can inline it — the index expressions and the query expressions then match after inlining.
--
-- Indexes: trigram GIN expression indexes (pg_trgm, 107) on vi_fold(<name>) for exactly the name columns the POS search
-- matches (apps/api/src/pos/pos-search.kysely.repository.ts): customers.full_name (customer, appointment, ticket and queue
-- results), technicians.full_name (technician and ticket results), services.name. Expression indexes, not stored
-- generated columns: adding a STORED column rewrites customers under an ACCESS EXCLUSIVE lock; an index built
-- CONCURRENTLY does not block writes. Tenant scoping is unchanged — every search still filters tenant_id (and branch_id)
-- first; these only speed up the name match. An interrupted CONCURRENTLY build leaves an INVALID index that migrate.mjs
-- drops before the retry.
CREATE OR REPLACE FUNCTION vi_fold(text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS 'SELECT btrim(regexp_replace(lower(translate($1, ''ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿĀāĂăĄąĆćĈĉĊċČčĎďĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĨĩĪīĬĭĮįİĴĵĶķĹĺĻļĽľŃńŅņŇňŌōŎŏŐőŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžƠơƯưǍǎǏǐǑǒǓǔǕǖǗǘǙǚǛǜǞǟǠǡǦǧǨǩǪǫǬǭǰǴǵǸǹǺǻȀȁȂȃȄȅȆȇȈȉȊȋȌȍȎȏȐȑȒȓȔȕȖȗȘșȚțȞȟȦȧȨȩȪȫȬȭȮȯȰȱȲȳḀḁḂḃḄḅḆḇḈḉḊḋḌḍḎḏḐḑḒḓḔḕḖḗḘḙḚḛḜḝḞḟḠḡḢḣḤḥḦḧḨḩḪḫḬḭḮḯḰḱḲḳḴḵḶḷḸḹḺḻḼḽḾḿṀṁṂṃṄṅṆṇṈṉṊṋṌṍṎṏṐṑṒṓṔṕṖṗṘṙṚṛṜṝṞṟṠṡṢṣṤṥṦṧṨṩṪṫṬṭṮṯṰṱṲṳṴṵṶṷṸṹṺṻṼṽṾṿẀẁẂẃẄẅẆẇẈẉẊẋẌẍẎẏẐẑẒẓẔẕẖẗẘẙẠạẢảẤấẦầẨẩẪẫẬậẮắẰằẲẳẴẵẶặẸẹẺẻẼẽẾếỀềỂểỄễỆệỈỉỊịỌọỎỏỐốỒồỔổỖỗỘộỚớỜờỞởỠỡỢợỤụỦủỨứỪừỬửỮữỰựỲỳỴỵỶỷỸỹĐđ̴̵̶̷̸̡̢̧̨̛̖̗̘̙̜̝̞̟̠̣̤̥̦̩̪̫̬̭̮̯̰̱̲̳̹̺̻̼͇͈͉͍͎̀́̂̃̄̅̆̇̈̉̊̋̌̍̎̏̐̑̒̓̔̽̾̿̀́͂̓̈́͆͊͋͌̕̚ͅ͏͓͔͕͖͙͚͐͑͒͗͛ͣͤͥͦͧͨͩͪͫͬͭͮͯ͘͜͟͢͝͞͠͡'', ''AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuyyAaAaAaCcCcCcCcDdEeEeEeEeEeGgGgGgGgHhIiIiIiIiIJjKkLlLlLlNnNnNnOoOoOoRrRrRrSsSsSsSsTtTtUuUuUuUuUuUuWwYyYZzZzZzOoUuAaIiOoUuUuUuUuUuAaAaGgKkOoOojGgNnAaAaAaEeEeIiIiOoOoRrRrUuUuSsTtHhAaEeOoOoOoOoYyAaBbBbBbCcDdDdDdDdDdEeEeEeEeEeFfGgHhHhHhHhHhIiIiKkKkKkLlLlLlLlMmMmMmNnNnNnNnOoOoOoOoPpPpRrRrRrRrSsSsSsSsSsTtTtTtTtUuUuUuUuUuVvVvWwWwWwWwWwXxXxYyZzZzZzhtwyAaAaAaAaAaAaAaAaAaAaAaAaEeEeEeEeEeEeEeEeIiIiOoOoOoOoOoOoOoOoOoOoOoOoUuUuUuUuUuUuUuYyYyYyYyDd'')), ''\s+'', '' '', ''g''))';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_full_name_vi_fold_trgm ON customers USING gin (vi_fold(full_name) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_technicians_full_name_vi_fold_trgm ON technicians USING gin (vi_fold(full_name) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_services_name_vi_fold_trgm ON services USING gin (vi_fold(name) gin_trgm_ops);
