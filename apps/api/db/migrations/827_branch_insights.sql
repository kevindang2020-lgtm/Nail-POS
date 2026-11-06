-- 827_branch_insights.sql — A3 AI Branch Comparison guide, the parts listed as "not built" (Nov 6 2026): the Branch Data
-- Health Checker records its runs next to the reports / alerts checks (ai_business_health_runs, area 'branches').
ALTER TABLE ai_business_health_runs DROP CONSTRAINT IF EXISTS ai_business_health_runs_area_check;
ALTER TABLE ai_business_health_runs ADD CONSTRAINT ai_business_health_runs_area_check CHECK (area IN ('reports', 'alerts', 'branches'));
