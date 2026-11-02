-- 465_support_session_extension.sql — Constitution 7 §78: extending a support session needs a reason, a permission and
-- an audit record, and cannot go on silently forever. Both session stores count their extensions; the rule (at most 2
-- extensions, never more than 2 hours from the start) lives in the service, and the count makes it enforceable.
ALTER TABLE support_access_sessions ADD COLUMN IF NOT EXISTS extension_count INT NOT NULL DEFAULT 0;
ALTER TABLE super_admin_support_sessions ADD COLUMN IF NOT EXISTS extension_count INT NOT NULL DEFAULT 0;
