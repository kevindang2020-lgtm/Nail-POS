-- 695_tenant_pos_language_authority.sql — English + Vietnamese POS mandate, WP-A (§13 conflict, §93): ONE authority for a
-- salon's default POS language.
--
-- Three representations existed: tenant_settings 'business-branch' settings_json.defaultLanguage (what the POS reads —
-- LanguageService.salonDefault), tenants.locale (migration 207, never written by any code path, read by the Super Admin
-- "Localization Distribution" chart and the POS Account overview) and the platform setting localization.default_language
-- ('en-US', a platform display default that never drove a tenant's POS).
--
-- From here: the AUTHORITY is the salon-wide row (branch_id IS NULL) of tenant_settings 'business-branch',
-- settings_json->>'defaultLanguage' ∈ {'en','vi'}; NULL / absent = not set (the POS shows English). Everything else is
-- DERIVED from it by the trigger below:
--   • the branch rows' defaultLanguage mirrors the salon-wide value (the POS Settings screen saves the Business & Branch
--     category on the BRANCH row and getRaw merges the branch and salon-wide rows in no fixed order — with two different
--     values the screen could show one language while the POS used the other);
--   • tenants.locale = 'en-US' / 'vi-VN' (BCP-47, LANGUAGE_LOCALE) or NULL — kept so old readers stay compatible.
-- A user's own choice (users.preferred_language, 560) is NOT touched: changing the salon default never overrides it.

-- 1. Salons whose default lives only on a branch row (the POS Settings screen wrote it there): lift the most recent branch
--    value to the salon-wide row, which salonDefault() already preferred — before this, an owner's choice saved on the
--    branch row was ignored whenever a salon-wide row without a language existed.
INSERT INTO tenant_settings (tenant_id, branch_id, category, settings_json)
SELECT DISTINCT ON (tenant_id) tenant_id, NULL, 'business-branch', jsonb_build_object('defaultLanguage', settings_json->>'defaultLanguage')
  FROM tenant_settings
 WHERE category = 'business-branch' AND branch_id IS NOT NULL AND settings_json->>'defaultLanguage' IN ('en', 'vi')
 ORDER BY tenant_id, updated_at DESC
ON CONFLICT (tenant_id, category) WHERE branch_id IS NULL
DO UPDATE SET settings_json = tenant_settings.settings_json || jsonb_build_object('defaultLanguage', EXCLUDED.settings_json->>'defaultLanguage'),
              updated_at = now()
 WHERE coalesce(tenant_settings.settings_json->>'defaultLanguage', '') NOT IN ('en', 'vi');

-- 2. Branch rows mirror the salon-wide value.
UPDATE tenant_settings b
   SET settings_json = b.settings_json || jsonb_build_object('defaultLanguage', w.settings_json->>'defaultLanguage')
  FROM tenant_settings w
 WHERE b.category = 'business-branch' AND b.branch_id IS NOT NULL
   AND w.tenant_id = b.tenant_id AND w.category = 'business-branch' AND w.branch_id IS NULL
   AND w.settings_json->>'defaultLanguage' IN ('en', 'vi')
   AND b.settings_json->>'defaultLanguage' IS DISTINCT FROM w.settings_json->>'defaultLanguage';

-- 3. tenants.locale becomes derived (nothing ever wrote it; a hand-set value that the POS never used is replaced).
UPDATE tenants t
   SET locale = CASE w.settings_json->>'defaultLanguage' WHEN 'vi' THEN 'vi-VN' WHEN 'en' THEN 'en-US' END
  FROM (SELECT t2.id, s.settings_json FROM tenants t2
          LEFT JOIN tenant_settings s ON s.tenant_id = t2.id AND s.category = 'business-branch' AND s.branch_id IS NULL) w
 WHERE w.id = t.id
   AND t.locale IS DISTINCT FROM (CASE w.settings_json->>'defaultLanguage' WHEN 'vi' THEN 'vi-VN' WHEN 'en' THEN 'en-US' END);

COMMENT ON COLUMN tenants.locale IS
  'DERIVED (695): en-US / vi-VN from tenant_settings business-branch (salon-wide) settings_json.defaultLanguage, NULL = not set. Never write it directly.';

-- 4. Keep the derived copies in step with whichever writer changes a business-branch row (POS Settings, Super Admin).
CREATE OR REPLACE FUNCTION sync_tenant_pos_language() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lang text := NEW.settings_json->>'defaultLanguage';
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;                       -- our own mirror writes below
  IF TG_OP = 'UPDATE' AND lang IS NOT DISTINCT FROM OLD.settings_json->>'defaultLanguage' THEN RETURN NULL; END IF;
  IF lang IS NULL OR lang NOT IN ('en', 'vi') THEN RETURN NULL; END IF;     -- an absent / bad value never clears the authority
  INSERT INTO tenant_settings (tenant_id, branch_id, category, settings_json)
  VALUES (NEW.tenant_id, NULL, 'business-branch', jsonb_build_object('defaultLanguage', lang))
  ON CONFLICT (tenant_id, category) WHERE branch_id IS NULL
  DO UPDATE SET settings_json = tenant_settings.settings_json || jsonb_build_object('defaultLanguage', lang), updated_at = now()
   WHERE tenant_settings.settings_json->>'defaultLanguage' IS DISTINCT FROM lang;
  UPDATE tenant_settings SET settings_json = settings_json || jsonb_build_object('defaultLanguage', lang)
   WHERE tenant_id = NEW.tenant_id AND category = 'business-branch' AND branch_id IS NOT NULL
     AND settings_json->>'defaultLanguage' IS DISTINCT FROM lang;
  UPDATE tenants SET locale = CASE lang WHEN 'vi' THEN 'vi-VN' ELSE 'en-US' END
   WHERE id = NEW.tenant_id AND locale IS DISTINCT FROM (CASE lang WHEN 'vi' THEN 'vi-VN' ELSE 'en-US' END);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_tenant_pos_language ON tenant_settings;
CREATE TRIGGER trg_tenant_pos_language
  AFTER INSERT OR UPDATE OF settings_json ON tenant_settings
  FOR EACH ROW WHEN (NEW.category = 'business-branch')
  EXECUTE FUNCTION sync_tenant_pos_language();
