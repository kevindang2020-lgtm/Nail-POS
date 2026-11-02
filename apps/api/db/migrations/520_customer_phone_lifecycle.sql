-- 520_customer_phone_lifecycle.sql — BUILD_PLAN Phase 3 (customer_phone_number_management, audit E1/E2/E7/E11).
--
-- E1: a phone-update session never recorded WHICH customer_phones row it proposed. Activation passed '' as the new
--     row's id, Postgres refused `id <> ''`, the error was swallowed into a false VERSION_CONFLICT, and every
--     SMS-verified change stopped at `phone_verified`. The session now carries `new_phone_id`.
-- E2: a session that was never finished stayed open forever (`uq_cpus_one_open`), and the customer could never start
--     another change. Sessions now expire (`expires_at`); a sweep and a queued job close them.
-- E7: the OLD number kept its booking verification after it was replaced. `booking_verified_phones` rows can now be
--     revoked, and a revoked row no longer counts as "recently verified".
-- E11: a canceled change left its number `pending_verification`, which the duplicate check then reported as somebody
--     else's number.
ALTER TABLE customer_phone_update_sessions ADD COLUMN IF NOT EXISTS new_phone_id UUID REFERENCES customer_phones(id);
ALTER TABLE customer_phone_update_sessions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
-- Manager approval (tenant setting `require_manager_approval`): who approved a receptionist's change, and when.
ALTER TABLE customer_phone_update_sessions ADD COLUMN IF NOT EXISTS approved_by_user_id UUID;
ALTER TABLE customer_phone_update_sessions ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
-- The customer types the code on the CUSTOMER DISPLAY instead of reading it aloud: staff asked for the pad at this time.
ALTER TABLE customer_phone_update_sessions ADD COLUMN IF NOT EXISTS display_requested_at TIMESTAMPTZ;

-- Open sessions created before this migration: link the pending row they proposed, and give them a deadline.
UPDATE customer_phone_update_sessions s
   SET new_phone_id = p.id
  FROM customer_phones p
 WHERE s.new_phone_id IS NULL
   AND p.tenant_id = s.tenant_id AND p.customer_id = s.customer_id
   AND p.phone_hash = s.proposed_phone_hash AND p.status = 'pending_verification';
UPDATE customer_phone_update_sessions
   SET expires_at = updated_at + interval '30 minutes'
 WHERE completed_at IS NULL AND expires_at IS NULL;

-- E11: a pending number no open session proposes is an abandoned one.
UPDATE customer_phones p
   SET status = 'inactive', updated_at = now()
 WHERE p.status = 'pending_verification'
   AND NOT EXISTS (SELECT 1 FROM customer_phone_update_sessions s
                    WHERE s.tenant_id = p.tenant_id AND s.customer_id = p.customer_id
                      AND s.completed_at IS NULL AND s.proposed_phone_hash = p.phone_hash);

CREATE INDEX IF NOT EXISTS idx_cpus_expiry ON customer_phone_update_sessions (expires_at) WHERE completed_at IS NULL;

-- E7: a replaced number's booking verification is revoked, not deleted (the history stays readable).
ALTER TABLE booking_verified_phones ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE booking_verified_phones ADD COLUMN IF NOT EXISTS revoked_reason TEXT;

-- E4: activation wrote the MASK ("••••0199") into customers.phone_display, so the POS list showed a mask and caller-ID
-- matched nothing. Repair from the number itself: North American numbers as "(856) 555-0199", others as E.164.
UPDATE customers
   SET phone_display = CASE WHEN normalized_phone ~ '^\+1[0-9]{10}$'
                            THEN '(' || substr(normalized_phone, 3, 3) || ') ' || substr(normalized_phone, 6, 3) || '-' || substr(normalized_phone, 9, 4)
                            ELSE normalized_phone END
 WHERE phone_display LIKE '%•%' AND normalized_phone IS NOT NULL;
UPDATE customer_phones
   SET phone_display = CASE WHEN normalized_phone ~ '^\+1[0-9]{10}$'
                            THEN '(' || substr(normalized_phone, 3, 3) || ') ' || substr(normalized_phone, 6, 3) || '-' || substr(normalized_phone, 9, 4)
                            ELSE normalized_phone END
 WHERE (phone_display IS NULL OR phone_display LIKE '%•%');
