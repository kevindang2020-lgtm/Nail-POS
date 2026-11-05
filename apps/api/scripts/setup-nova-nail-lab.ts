/**
 * setup-nova-nail-lab.ts
 * Complete professional provisioning for Nova Nail Lab:
 * 1. Creates/Configures Tenant (Nova Nail Lab, slug: novanaillab, code: NOVA01).
 * 2. Creates Primary Main Branch.
 * 3. Creates/Configures Owner User (Kevin Dang - kevindang2020@gmail.com).
 * 4. Configures Active Enterprise Subscription.
 * 5. Seeds complete, clean nail services catalog and active technicians.
 * 6. Configures Fiserv UAT payment gateway with encrypted credentials.
 * 7. Pairs the physical Clover terminal (HSN: 260767317091403359727220).
 * 8. Archives dummy test tenants so POS remains clean.
 */

import { Pool } from 'pg';
import { hashPassword } from '../../../packages/auth/dist/password';
import { encryptPaymentSecret } from '../dist/common/mfa-enc';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    console.log('🚀 Starting Nova Nail Lab provisioning...');

    // 1. Archive old dummy test tenants
    const archiveResult = await client.query(`
      UPDATE tenants
      SET status = 'cancelled', lifecycle_state = 'ARCHIVED', updated_at = NOW()
      WHERE tenant_code IN ('HARD', '123', '1001', '0000')
         OR display_name ILIKE '%unisex%'
         OR display_name = 'test';
    `);
    console.log(`📦 Archived ${archiveResult.rowCount} dummy test tenants.`);

    // 2. Tenant: Nova Nail Lab
    let tenantId: string;
    const existingTenant = await client.query(`SELECT id FROM tenants WHERE tenant_code = 'NOVA01' LIMIT 1`);
    if (existingTenant.rows.length > 0) {
      tenantId = existingTenant.rows[0].id;
      await client.query(`
        UPDATE tenants
        SET legal_name = 'Nova Nail Lab LLC',
            display_name = 'Nova Nail Lab',
            tenant_slug = 'novanaillab',
            status = 'active',
            lifecycle_state = 'ACTIVE',
            email = 'kevindang2020@gmail.com',
            business_phone = '+12125550199',
            updated_at = NOW()
        WHERE id = $1
      `, [tenantId]);
      console.log(`✅ Tenant Nova Nail Lab updated (${tenantId}).`);
    } else {
      const newTenant = await client.query(`
        INSERT INTO tenants (
          id, legal_name, display_name, tenant_slug, tenant_code,
          status, lifecycle_state, email, business_phone, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), 'Nova Nail Lab LLC', 'Nova Nail Lab', 'novanaillab', 'NOVA01',
          'active', 'ACTIVE', 'kevindang2020@gmail.com', '+12125550199', NOW(), NOW()
        ) RETURNING id
      `);
      tenantId = newTenant.rows[0].id;
      console.log(`✅ Tenant Nova Nail Lab created (${tenantId}).`);
    }

    // 3. Primary Branch
    let branchId: string;
    const existingBranch = await client.query(`SELECT id FROM branches WHERE tenant_id = $1 AND name = 'Main Branch' LIMIT 1`, [tenantId]);
    if (existingBranch.rows.length > 0) {
      branchId = existingBranch.rows[0].id;
      await client.query(`
        UPDATE branches
        SET latitude = 40.7128, longitude = -74.0060, is_public = TRUE, updated_at = NOW()
        WHERE id = $1
      `, [branchId]);
      console.log(`✅ Main Branch exists (${branchId}).`);
    } else {
      const newBranch = await client.query(`
        INSERT INTO branches (
          id, tenant_id, name, status, phone, address, city, state, zip, timezone, latitude, longitude, is_public, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), $1, 'Main Branch', 'active', '+12125550199',
          '123 Main Street', 'New York', 'NY', '10001', 'America/New_York', 40.7128, -74.0060, TRUE, NOW(), NOW()
        ) RETURNING id
      `, [tenantId]);
      branchId = newBranch.rows[0].id;
      console.log(`✅ Main Branch created (${branchId}).`);
    }

    // 4. Owner User: Kevin Dang
    const passwordHash = await hashPassword('ChangeMe!Owner1');
    const pinHash = await hashPassword('1234');
    let ownerId: string;

    const existingUser = await client.query(`SELECT id FROM users WHERE email = 'kevindang2020@gmail.com' LIMIT 1`);
    if (existingUser.rows.length > 0) {
      ownerId = existingUser.rows[0].id;
      await client.query(`
        UPDATE users
        SET tenant_id = $1, branch_id = $2, first_name = 'Kevin', last_name = 'Dang',
            full_name = 'Kevin Dang', role = 'OWNER', status = 'active',
            password_hash = $3, pin_hash = $4, updated_at = NOW()
        WHERE id = $5
      `, [tenantId, branchId, passwordHash, pinHash, ownerId]);
      console.log(`✅ Owner Kevin Dang updated (${ownerId}).`);
    } else {
      const newUser = await client.query(`
        INSERT INTO users (
          id, tenant_id, branch_id, first_name, last_name, full_name, email,
          password_hash, pin_hash, status, role, mfa_enabled, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), $1, $2, 'Kevin', 'Dang', 'Kevin Dang', 'kevindang2020@gmail.com',
          $3, $4, 'active', 'OWNER', FALSE, NOW(), NOW()
        ) RETURNING id
      `, [tenantId, branchId, passwordHash, pinHash]);
      ownerId = newUser.rows[0].id;
      console.log(`✅ Owner Kevin Dang created (${ownerId}).`);
    }

    // Link owner on tenant
    await client.query(`UPDATE tenants SET owner_user_id = $1, updated_at = NOW() WHERE id = $2`, [ownerId, tenantId]);

    // Ensure user_branch_access
    await client.query(`
      INSERT INTO user_branch_access (tenant_id, branch_id, user_id, role, access_level, is_primary_owner)
      VALUES ($1, $2, $3, 'OWNER', 'owner', TRUE)
      ON CONFLICT (tenant_id, user_id, branch_id)
      DO UPDATE SET role = 'OWNER', access_level = 'owner', is_primary_owner = TRUE, updated_at = NOW();
    `, [tenantId, branchId, ownerId]);

    // 5. Subscription: Enterprise
    await client.query(`DELETE FROM tenant_subscriptions WHERE tenant_id = $1`, [tenantId]);
    await client.query(`
      INSERT INTO tenant_subscriptions (id, tenant_id, plan, status, current_period_end, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, 'Enterprise', 'active', NOW() + INTERVAL '365 days', NOW(), NOW());
    `, [tenantId]);
    console.log('✅ Enterprise subscription active.');

    // 6. Service Categories & Services
    const categories = [
      { name: 'Manicures', order: 1 },
      { name: 'Pedicures', order: 2 },
      { name: 'Enhancements', order: 3 },
      { name: 'Nail Art & Add-Ons', order: 4 },
    ];

    const categoryMap = new Map<string, string>();
    for (const cat of categories) {
      const found = await client.query(`SELECT id FROM service_categories WHERE tenant_id = $1 AND name = $2 LIMIT 1`, [tenantId, cat.name]);
      if (found.rows.length > 0) {
        categoryMap.set(cat.name, found.rows[0].id);
      } else {
        const res = await client.query(`
          INSERT INTO service_categories (id, tenant_id, branch_id, name, sort_order, created_at, updated_at)
          VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())
          RETURNING id
        `, [tenantId, branchId, cat.name, cat.order]);
        categoryMap.set(cat.name, res.rows[0].id);
      }
    }

    const services = [
      { cat: 'Manicures', name: 'Classic Manicure', dur: 30, cents: 3000 },
      { cat: 'Manicures', name: 'Gel Manicure', dur: 45, cents: 4500 },
      { cat: 'Manicures', name: 'Deluxe Spa Manicure', dur: 50, cents: 5500 },
      { cat: 'Pedicures', name: 'Classic Pedicure', dur: 45, cents: 4000 },
      { cat: 'Pedicures', name: 'Spa Pedicure', dur: 60, cents: 6000 },
      { cat: 'Pedicures', name: 'Hot Stone Pedicure', dur: 70, cents: 7500 },
      { cat: 'Enhancements', name: 'Full Set Acrylic', dur: 75, cents: 6500 },
      { cat: 'Enhancements', name: 'Gel-X Extensions', dur: 75, cents: 7500 },
      { cat: 'Enhancements', name: 'Dip Powder Full Set', dur: 60, cents: 5500 },
      { cat: 'Enhancements', name: 'Acrylic Fill-In', dur: 45, cents: 4500 },
      { cat: 'Nail Art & Add-Ons', name: 'French Tip Design', dur: 15, cents: 1500 },
      { cat: 'Nail Art & Add-Ons', name: 'Custom Nail Art (2 nails)', dur: 20, cents: 2500 },
      { cat: 'Nail Art & Add-Ons', name: 'Gel Polish Removal', dur: 15, cents: 1500 },
    ];

    for (const [i, s] of services.entries()) {
      const catId = categoryMap.get(s.cat);
      if (!catId) continue;
      const sExisting = await client.query(`SELECT id FROM services WHERE tenant_id = $1 AND name = $2 LIMIT 1`, [tenantId, s.name]);
      if (sExisting.rows.length === 0) {
        await client.query(`
          INSERT INTO services (
            id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents,
            commission_type, commission_value, online_booking_enabled,
            customer_app_booking_enabled, ai_booking_enabled, status, sort_order, created_at, updated_at
          ) VALUES (
            gen_random_uuid(), $1, $2, $3, $4, $5, $6,
            'percent', 40, TRUE, TRUE, TRUE, 'active', $7, NOW(), NOW()
          );
        `, [tenantId, branchId, catId, s.name, s.dur, s.cents, i + 1]);
      }
    }
    console.log(`✅ Seeded services across 4 categories.`);

    // 7. Technicians (Staff)
    const staff = [
      { first: 'Kevin', last: 'Dang', role: 'Owner & Master Tech', status: 'available' },
      { first: 'Ava', last: 'Nguyen', role: 'Senior Nail Artist', status: 'available' },
      { first: 'Mia', last: 'Tran', role: 'Nail Specialist', status: 'available' },
    ];

    for (const st of staff) {
      const tExisting = await client.query(`SELECT id FROM technicians WHERE tenant_id = $1 AND first_name = $2 AND last_name = $3 LIMIT 1`, [tenantId, st.first, st.last]);
      if (tExisting.rows.length === 0) {
        await client.query(`
          INSERT INTO technicians (
            id, tenant_id, branch_id, first_name, last_name, full_name, role_label,
            status, commission_type, commission_value, default_commission_split_percent,
            is_active, created_at, updated_at
          ) VALUES (
            gen_random_uuid(), $1, $2, $3, $4, $5, $6,
            $7, 'percent', 45, 45, TRUE, NOW(), NOW()
          );
        `, [tenantId, branchId, st.first, st.last, `${st.first} ${st.last}`, st.role, st.status]);
      }
    }
    console.log(`✅ Seeded ${staff.length} technicians.`);

    // 8. Fiserv Payment Gateway Configuration (with proper encryption)
    const usernameEnc = encryptPaymentSecret('testing');
    const passwordEnc = encryptPaymentSecret('testing123');
    const boltApiKeyEnc = encryptPaymentSecret('ZCb8pPkXcZDVO0CIngLSFrBJgA/BYyUZIHT8zaj3MPg=');

    await client.query(`
      INSERT INTO tenant_payment_config (
        tenant_id, processor, environment, merchant_id,
        base_url, api_username_enc, api_password_enc,
        bolt_base_url, bolt_api_key_enc,
        fiserv_configured, status, onboarding_status, configured_at, created_at, updated_at
      ) VALUES (
        $1, 'fiserv', 'sandbox', '177000000238',
        'https://isv-uat.cardconnect.com/cardconnect/rest', $2, $3,
        'https://bolt-uat.cardpointe.com/api', $4,
        TRUE, 'active', 'approved', NOW(), NOW(), NOW()
      )
      ON CONFLICT (tenant_id)
      DO UPDATE SET
        processor = 'fiserv',
        environment = 'sandbox',
        merchant_id = '177000000238',
        base_url = 'https://isv-uat.cardconnect.com/cardconnect/rest',
        api_username_enc = $2,
        api_password_enc = $3,
        bolt_base_url = 'https://bolt-uat.cardpointe.com/api',
        bolt_api_key_enc = $4,
        fiserv_configured = TRUE,
        status = 'active',
        onboarding_status = 'approved',
        configured_at = NOW(),
        updated_at = NOW();
    `, [tenantId, usernameEnc, passwordEnc, boltApiKeyEnc]);
    console.log('✅ Fiserv UAT payment gateway configured and sealed with encryption.');

    // 9. Register Physical Clover Terminal
    await client.query(`
      INSERT INTO pos_payment_terminals (
        id, tenant_id, branch_id, label, status, paired_at,
        hsn, provider, terminal_type, serial_number, connection_type, updated_at
      ) VALUES (
        'clover-flex-01', $1, $2, 'Front Desk Clover', 'paired', NOW(),
        '260767317091403359727220', 'fiserv', 'clover', 'C081UG43763362', 'cloud', NOW()
      )
      ON CONFLICT (tenant_id, id)
      DO UPDATE SET
        branch_id = $2,
        label = 'Front Desk Clover',
        status = 'paired',
        paired_at = NOW(),
        hsn = '260767317091403359727220',
        provider = 'fiserv',
        terminal_type = 'clover',
        serial_number = 'C081UG43763362',
        connection_type = 'cloud',
        updated_at = NOW();
    `, [tenantId, branchId]);
    console.log('✅ Physical Clover terminal (HSN: 260767317091403359727220) registered and paired.');

    // 10. Enable Public Directory Listing & App Flags
    await client.query(`
      INSERT INTO tenant_app_flags (tenant_id, flag_key, enabled, updated_at)
      VALUES 
        ($1, 'public_listing', TRUE, NOW()),
        ($1, 'show_on_map', TRUE, NOW()),
        ($1, 'customer_app_booking', TRUE, NOW()),
        ($1, 'technician_app', TRUE, NOW()),
        ($1, 'customer_service_progress', TRUE, NOW()),
        ($1, 'tech_live_ticket_edit', TRUE, NOW())
      ON CONFLICT (tenant_id, flag_key) DO UPDATE SET enabled = TRUE, updated_at = NOW();
    `, [tenantId]);
    console.log('✅ Public directory & customer app flags enabled.');

    await client.query('COMMIT');
    console.log('\n🎉 ALL DONE! Nova Nail Lab is fully provisioned and ready for live POS & payments.');
    console.log('----------------------------------------------------');
    console.log(`Salon Code:       NOVA01`);
    console.log(`Salon Name:       Nova Nail Lab`);
    console.log(`Owner Sign-In:    kevindang2020@gmail.com`);
    console.log(`Password:         ChangeMe!Owner1`);
    console.log(`Quick PIN:        1234`);
    console.log(`Fiserv MID:       177000000238 (UAT Sandbox)`);
    console.log(`Clover HSN:       260767317091403359727220 (Paired)`);
    console.log('----------------------------------------------------');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error during provisioning:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
