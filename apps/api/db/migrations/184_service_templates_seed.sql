-- 184_service_templates_seed.sql — idempotent seed for the service-template catalog. 10 categories + 10 master
-- templates matching the reference, with resources, a few add-ons, v1 version snapshots, and a small number of REAL
-- deployments to pilot tenants (honest usage counts — not the reference's demo figures).

INSERT INTO service_template_categories (code, name, icon_key, display_order) VALUES
  ('manicure','Manicure','hand',1),
  ('pedicure','Pedicure','foot',2),
  ('gel_manicure','Gel Manicure','sparkle',3),
  ('acrylic_full_set','Acrylic Full Set','layers',4),
  ('acrylic_fill','Acrylic Fill','layers',5),
  ('nail_art','Nail Art','brush',6),
  ('waxing','Waxing','flame',7),
  ('eyelash_services','Eyelash Services','eye',8),
  ('facial_services','Facial Services','face',9),
  ('combination_packages','Combination Packages','gift',10)
ON CONFLICT (code) DO NOTHING;

INSERT INTO service_templates
  (code, name, category_code, description, suggested_duration_minutes, suggested_price_min_cents, suggested_price_max_cents, tax_setting, commission_eligible, status, version, version_label, display_order)
VALUES
  ('classic_manicure','Classic Manicure','manicure','Standard manicure with shaping, cuticle care, and polish.',30,2000,3500,'taxable',true,'published',3,'v2.3',1),
  ('spa_pedicure','SPA Pedicure','pedicure','Relaxing spa pedicure with soak, scrub, and massage.',45,3500,5500,'taxable',true,'published',4,'v3.1',2),
  ('gel_manicure','Gel Manicure','gel_manicure','Long-lasting gel polish manicure cured under UV lamp.',45,3000,5000,'taxable',true,'published',4,'v2.4',3),
  ('acrylic_full_set','Acrylic Full Set','acrylic_full_set','Full set of acrylic nails with shaping and finish.',90,6000,9000,'taxable',true,'published',3,'v2.2',4),
  ('acrylic_fill','Acrylic Fill','acrylic_fill','Acrylic fill maintenance for existing set.',60,3500,5500,'taxable',true,'published',3,'v2.1',5),
  ('nail_art_design','Nail Art Design','nail_art','Custom nail art and hand-painted designs.',30,1500,4000,'taxable',true,'published',2,'v1.5',6),
  ('full_body_wax','Full Body Wax','waxing','Full body waxing service.',60,5000,9000,'taxable',false,'published',3,'v2.0',7),
  ('eyelash_extensions','Eyelash Extensions','eyelash_services','Individual eyelash extension application.',90,8000,15000,'non_taxable',true,'published',4,'v2.6',8),
  ('hydra_facial','Hydra Facial','facial_services','Hydrating facial treatment with cleansing and serum.',60,7000,12000,'taxable',false,'published',2,'v1.8',9),
  ('bridal_beauty_package','Bridal Beauty Package','combination_packages','Combination bridal package: nails, lashes, and facial.',150,15000,25000,'taxable',true,'published',5,'v3.0',10)
ON CONFLICT (code) DO NOTHING;

-- Required resources per template.
INSERT INTO service_template_resources (template_id, resource_label, quantity, display_order)
SELECT t.id, v.label, v.qty, v.ord FROM (VALUES
  ('classic_manicure','Nail Tech',1,1),('classic_manicure','Station',1,2),
  ('spa_pedicure','Nail Tech',1,1),('spa_pedicure','Pedicure Chair',1,2),
  ('gel_manicure','Nail Tech',1,1),('gel_manicure','UV Lamp',1,2),
  ('acrylic_full_set','Nail Tech',1,1),('acrylic_full_set','Acrylic Kit',1,2),
  ('acrylic_fill','Nail Tech',1,1),('acrylic_fill','Acrylic Kit',1,2),
  ('nail_art_design','Nail Tech',1,1),('nail_art_design','Art Tools',1,2),
  ('full_body_wax','Esthetician',1,1),('full_body_wax','Wax Station',1,2),
  ('eyelash_extensions','Lash Tech',1,1),('eyelash_extensions','Lash Bed',1,2),
  ('hydra_facial','Esthetician',1,1),('hydra_facial','Facial Machine',1,2),
  ('bridal_beauty_package','Multi',2,1),('bridal_beauty_package','Multi Stations',2,2)
) AS v(code,label,qty,ord)
JOIN service_templates t ON t.code = v.code
WHERE NOT EXISTS (SELECT 1 FROM service_template_resources r WHERE r.template_id = t.id AND r.resource_label = v.label);

-- A few optional add-ons.
INSERT INTO service_template_addons (template_id, name, price_cents, display_order)
SELECT t.id, v.name, v.cents, v.ord FROM (VALUES
  ('gel_manicure','French Tip',800,1),('gel_manicure','Chrome Finish',1200,2),
  ('spa_pedicure','Callus Removal',1000,1),('spa_pedicure','Paraffin Dip',1500,2),
  ('classic_manicure','Gel Top Coat',700,1),
  ('bridal_beauty_package','Trial Session',5000,1)
) AS v(code,name,cents,ord)
JOIN service_templates t ON t.code = v.code
ON CONFLICT (template_id, name) DO NOTHING;

-- v1 version rows (baseline history).
INSERT INTO service_template_versions (template_id, version_number, version_label, change_reason)
SELECT t.id, 1, 'v1.0', 'Initial template'
FROM service_templates t
WHERE NOT EXISTS (SELECT 1 FROM service_template_versions v WHERE v.template_id = t.id AND v.version_number = 1);

-- Real deployments to pilot tenants (honest, small usage counts).
INSERT INTO service_template_deployments (template_id, tenant_id, customizable, customized)
SELECT t.id, v.tenant::uuid, true, v.customized FROM (VALUES
  ('classic_manicure','e167929e-8d62-4de5-8a0b-0b727d08be38', true),
  ('classic_manicure','d45202a2-9910-4431-966e-0e372a702251', false),
  ('gel_manicure','e167929e-8d62-4de5-8a0b-0b727d08be38', false),
  ('spa_pedicure','e167929e-8d62-4de5-8a0b-0b727d08be38', true)
) AS v(code, tenant, customized)
JOIN service_templates t ON t.code = v.code
-- Guard: only seed deployments for tenants that actually exist (demo-seeded DBs). On a clean
-- database this inserts nothing, keeping migrations runnable from scratch without demo data.
JOIN tenants te ON te.id = v.tenant::uuid
ON CONFLICT (template_id, tenant_id) DO NOTHING;
