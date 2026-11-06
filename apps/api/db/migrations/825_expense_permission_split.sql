-- 825_expense_permission_split.sql — F7 §73 (Kevin, Nov 6 2026: "pick best for my POS").
-- owner.expenses.manage used to cover deleting a draft, archiving / restoring and recording bill payments. Those are now
-- their own keys (owner.expenses.delete_draft, owner.expenses.archive, owner.expenses.bills.manage) so the role editor can
-- give "record expenses" without them. NOBODY LOSES ACCESS: the OWNER / MANAGER base sets carry the new keys (rbac.ts),
-- and here every saved custom role and every live per-user override that names owner.expenses.manage gets the same three
-- keys with the same effect (an ALLOW keeps working, a DENY keeps denying). Idempotent.
UPDATE tenant_custom_roles r
   SET permissions = (SELECT jsonb_agg(DISTINCT x) FROM jsonb_array_elements_text(r.permissions || '["owner.expenses.delete_draft","owner.expenses.archive","owner.expenses.bills.manage"]'::jsonb) x)
 WHERE jsonb_typeof(r.permissions) = 'array' AND r.permissions ? 'owner.expenses.manage'
   AND NOT (r.permissions ?& ARRAY['owner.expenses.delete_draft','owner.expenses.archive','owner.expenses.bills.manage']);

INSERT INTO tenant_user_permission_overrides (tenant_id, user_id, permission, effect, reason, branch_id, granted_by_user_id, starts_at, expires_at)
SELECT o.tenant_id, o.user_id, k.key, o.effect, o.reason || ' (carried over when owner.expenses.manage was split, Nov 2026)', o.branch_id, o.granted_by_user_id, o.starts_at, o.expires_at
  FROM tenant_user_permission_overrides o
 CROSS JOIN (VALUES ('owner.expenses.delete_draft'), ('owner.expenses.archive'), ('owner.expenses.bills.manage')) AS k(key)
 WHERE o.permission = 'owner.expenses.manage' AND o.revoked_at IS NULL
ON CONFLICT DO NOTHING;
