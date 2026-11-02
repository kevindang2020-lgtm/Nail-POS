# Promotions build — audit miss, clobber, and full recovery (2026-07-06)

## What happened
Intending to build a NEW salon promotions/coupons feature, I did not audit thoroughly enough and
missed a PRE-EXISTING platform promotions module at apps/api/src/promotions/ (@Controller('promotions'),
already registered in AppModule). My audit grep matched marketing/campaign controllers and promotion
GET routes containing the word, but the pre-existing module's routes (e.g. @Get('state')) didn't match,
so I never saw it.

I then created files with `cat >` heredocs, which OVERWROTE five original files
(promotions.repository.ts, promotions.kysely.repository.ts, promotions.service.ts,
promotions.controller.ts, promotions.module.ts) and added a stray promotions.dto.ts.

## How it was caught
The pre-existing promotions.vitest.spec.ts imports PromotionsService/PromotionError and
InMemoryPromotionsRepository/PromotionFacts — symbols my overwrites didn't provide. Since that spec was
part of the green baseline suite, the imports proved the originals had existed. I stopped immediately.

## Recovery (no git in this workspace)
Every zip I produced earlier this session includes src/ (dist excluded) and predates this turn, so the
original promotions/*.ts were intact inside AIPowerSalon-Marketing-Dashboard-2026-07-06.zip. I:
1. Extracted and restored the five overwritten files (verified byte-identical via diff).
2. Deleted my stray promotions.dto.ts.
3. Removed my mistaken migration 319_salon_promotions.sql.
4. Reverted my kysely.types additions (SalonPromotionsTable + salon_promotions).

## Verified clean state
- API: tsc 0 · build clean · DI_GRAPH_OK · **3022/3022** (exactly the pre-incident baseline:
  3013 + 5 gift-cards + 4 loyalty). Original platform promotions engine passes its 6 tests.
- pos-web: tsc 0 · **366/366**. The (legitimate, earlier) Marketing Dashboard redirect is intact.
- My gift-cards and loyalty slices from earlier this session are untouched.
- All of my mistaken salon-promotions work is reverted; nothing of it remains.

## Lessons / process fix
- Audit-first must include: grep @Controller across ALL route strings, ls the target directory, and
  check kysely.types + AppModule BEFORE writing any file.
- Prefer create_file (fails on existing paths) over `cat >` for new files, so an accidental overwrite
  is impossible.

## If a salon promotions feature is still wanted
It remains a legitimate gap (salon customer coupons, distinct from platform billing promotions). It
should be built deliberately as a clearly separate module (e.g. `salon-promotions/`, table
`salon_promotions`) to avoid any collision with the platform `promotions` module — but only on your go.
