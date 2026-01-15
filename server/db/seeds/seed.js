/**
 * Seed script for Amazon Hub Brain
 *
 * This script populates the database with sample data for development and testing.
 * Run with: npm run seed
 */

import supabase from '../../services/supabase.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const SALT_ROUNDS = 10;

async function seed() {
  console.log('Starting seed process...\n');

  try {
    // 1. Create admin user
    console.log('Creating admin user...');
    // Use environment variable override or generate random password
    const adminPlainPassword = process.env.SEED_ADMIN_PASSWORD || crypto.randomBytes(16).toString('hex');
    const adminPasswordHash = await bcrypt.hash(adminPlainPassword, SALT_ROUNDS);
    const { data: adminUser, error: adminError } = await supabase
      .from('users')
      .upsert({
        email: 'admin@invicta.local',
        password_hash: adminPasswordHash,
        name: 'Admin User',
        role: 'ADMIN',
        is_active: true,
      }, { onConflict: 'email' })
      .select()
      .single();

    if (adminError) {
      console.error('Admin user error:', adminError);
    } else {
      console.log(`  Created admin: admin@invicta.local / ${adminPlainPassword}`);
    }

    // 2. Create staff user
    console.log('Creating staff user...');
    // Use environment variable override or generate random password
    const staffPlainPassword = process.env.SEED_STAFF_PASSWORD || crypto.randomBytes(16).toString('hex');
    const staffPasswordHash = await bcrypt.hash(staffPlainPassword, SALT_ROUNDS);
    const { data: staffUser, error: staffError } = await supabase
      .from('users')
      .upsert({
        email: 'staff@invicta.local',
        password_hash: staffPasswordHash,
        name: 'Staff User',
        role: 'STAFF',
        is_active: true,
      }, { onConflict: 'email' })
      .select()
      .single();

    if (staffError) {
      console.error('Staff user error:', staffError);
    } else {
      console.log(`  Created staff: staff@invicta.local / ${staffPlainPassword}`);
    }

    // 3. Create sample components
    console.log('\nCreating sample components...');
    const components = [
      { internal_sku: 'MAK-DHP481', description: 'Makita DHP481 Combi Drill Body', brand: 'Makita', cost_ex_vat_pence: 8999, weight_grams: 2100 },
      { internal_sku: 'MAK-BL1850B', description: 'Makita 18V 5.0Ah LXT Battery', brand: 'Makita', cost_ex_vat_pence: 5499, weight_grams: 680 },
      { internal_sku: 'MAK-DC18RC', description: 'Makita DC18RC Charger', brand: 'Makita', cost_ex_vat_pence: 3499, weight_grams: 600 },
      { internal_sku: 'MAK-CASE-L', description: 'Makita Large Carry Case', brand: 'Makita', cost_ex_vat_pence: 2499, weight_grams: 1200 },
      { internal_sku: 'DEW-DCD996', description: 'DeWalt DCD996 Hammer Drill Body', brand: 'DeWalt', cost_ex_vat_pence: 12999, weight_grams: 2300 },
      { internal_sku: 'DEW-DCB184', description: 'DeWalt 18V 5.0Ah XR Battery', brand: 'DeWalt', cost_ex_vat_pence: 6999, weight_grams: 620 },
      { internal_sku: 'DEW-DCB115', description: 'DeWalt DCB115 Charger', brand: 'DeWalt', cost_ex_vat_pence: 2999, weight_grams: 500 },
      { internal_sku: 'DEW-TSTAK-II', description: 'DeWalt TSTAK II Tool Box', brand: 'DeWalt', cost_ex_vat_pence: 1999, weight_grams: 1800 },
      { internal_sku: 'MIL-M18FPD2', description: 'Milwaukee M18 FPD2 Percussion Drill Body', brand: 'Milwaukee', cost_ex_vat_pence: 14999, weight_grams: 2000 },
      { internal_sku: 'MIL-M18B5', description: 'Milwaukee M18 5.0Ah Battery', brand: 'Milwaukee', cost_ex_vat_pence: 7499, weight_grams: 700 },
    ];

    const componentResults = [];
    for (const comp of components) {
      const { data, error } = await supabase
        .from('components')
        .upsert(comp, { onConflict: 'internal_sku' })
        .select()
        .single();
      if (error) {
        console.error(`  Error creating ${comp.internal_sku}:`, error.message);
      } else {
        componentResults.push(data);
        console.log(`  Created component: ${comp.internal_sku}`);
      }
    }

    // 4. Create stock for components
    console.log('\nCreating component stock...');
    for (const comp of componentResults) {
      const { error } = await supabase
        .from('component_stock')
        .upsert({
          component_id: comp.id,
          location: 'Warehouse',
          on_hand: Math.floor(Math.random() * 50) + 10,
          reserved: 0,
        }, { onConflict: 'component_id,location' });
      if (error) {
        console.error(`  Stock error for ${comp.internal_sku}:`, error.message);
      }
    }
    console.log('  Stock levels created');

    // 5. Create sample BOMs
    console.log('\nCreating sample BOMs...');
    const boms = [
      {
        bundle_sku: 'MAK-DHP481-KIT',
        description: 'Makita DHP481 18V Combi Drill Kit with 2x 5.0Ah',
        components: ['MAK-DHP481', 'MAK-BL1850B', 'MAK-BL1850B', 'MAK-DC18RC', 'MAK-CASE-L'],
      },
      {
        bundle_sku: 'MAK-DHP481-BODY',
        description: 'Makita DHP481 18V Combi Drill Body Only',
        components: ['MAK-DHP481'],
      },
      {
        bundle_sku: 'DEW-DCD996-KIT',
        description: 'DeWalt DCD996 18V XR Hammer Drill Kit with 2x 5.0Ah',
        components: ['DEW-DCD996', 'DEW-DCB184', 'DEW-DCB184', 'DEW-DCB115', 'DEW-TSTAK-II'],
      },
      {
        bundle_sku: 'DEW-DCD996-BODY',
        description: 'DeWalt DCD996 18V XR Hammer Drill Body Only',
        components: ['DEW-DCD996'],
      },
    ];

    for (const bom of boms) {
      // Create BOM
      const { data: bomData, error: bomError } = await supabase
        .from('boms')
        .upsert({
          bundle_sku: bom.bundle_sku,
          description: bom.description,
        }, { onConflict: 'bundle_sku' })
        .select()
        .single();

      if (bomError) {
        console.error(`  BOM error for ${bom.bundle_sku}:`, bomError.message);
        continue;
      }

      console.log(`  Created BOM: ${bom.bundle_sku}`);

      // Delete existing components
      await supabase.from('bom_components').delete().eq('bom_id', bomData.id);

      // Count component occurrences
      const compCounts = {};
      for (const sku of bom.components) {
        compCounts[sku] = (compCounts[sku] || 0) + 1;
      }

      // Add components
      for (const [sku, qty] of Object.entries(compCounts)) {
        const comp = componentResults.find(c => c.internal_sku === sku);
        if (comp) {
          await supabase.from('bom_components').insert({
            bom_id: bomData.id,
            component_id: comp.id,
            qty_required: qty,
          });
        }
      }
    }

    // 6. Create sample listing memory entries
    console.log('\nCreating sample listing memory entries...');
    const listings = [
      {
        asin: 'B07WFZFP95',
        sku: 'MAK-DHP481-KIT-AMZ',
        title: 'Makita DHP481RTJ 18V LXT Brushless Combi Drill Kit 2x 5.0Ah',
        bom_sku: 'MAK-DHP481-KIT',
      },
      {
        asin: 'B07WG123AB',
        sku: 'MAK-DHP481-BODY-AMZ',
        title: 'Makita DHP481Z 18V LXT Brushless Combi Drill Body Only',
        bom_sku: 'MAK-DHP481-BODY',
      },
      {
        asin: 'B08XYZ1234',
        sku: 'DEW-DCD996-KIT-AMZ',
        title: 'DEWALT DCD996P2-GB 18V XR Brushless Hammer Drill Kit',
        bom_sku: 'DEW-DCD996-KIT',
      },
    ];

    // Get BOMs for linking
    const { data: allBoms } = await supabase.from('boms').select('id, bundle_sku');

    for (const listing of listings) {
      const bom = allBoms?.find(b => b.bundle_sku === listing.bom_sku);
      const fingerprint = listing.title.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
      const fingerprintHash = crypto.createHash('sha256').update(fingerprint).digest('hex');

      const { error } = await supabase
        .from('listing_memory')
        .upsert({
          asin: listing.asin,
          sku: listing.sku,
          title_fingerprint: fingerprint,
          title_fingerprint_hash: fingerprintHash,
          bom_id: bom?.id || null,
          resolution_source: 'SEED',
          is_active: true,
          created_by_actor_type: 'SYSTEM',
          created_by_actor_id: 'seed-script',
          created_by_actor_display: 'Seed Script',
        }, { onConflict: 'asin' });

      if (error) {
        console.error(`  Listing error for ${listing.asin}:`, error.message);
      } else {
        console.log(`  Created listing: ${listing.asin}`);
      }
    }

    // 7. Create Keepa settings
    console.log('\nCreating Keepa settings...');
    const keepaSettings = [
      { setting_key: 'max_tokens_per_hour', setting_value: '800' },
      { setting_key: 'max_tokens_per_day', setting_value: '6000' },
      { setting_key: 'min_reserve', setting_value: '200' },
      { setting_key: 'min_refresh_minutes', setting_value: '720' },
      { setting_key: 'domain_id', setting_value: '3' }, // UK
    ];

    for (const setting of keepaSettings) {
      await supabase.from('keepa_settings').upsert(setting, { onConflict: 'setting_key' });
    }
    console.log('  Keepa settings configured');

    console.log('\n✅ Seed completed successfully!');
    console.log('\nTest accounts:');
    console.log(`  Admin: admin@invicta.local / ${adminPlainPassword}`);
    console.log(`  Staff: staff@invicta.local / ${staffPlainPassword}`);
    console.log('\nNOTE: Save these credentials now - they are randomly generated and will not be shown again.');
    console.log('      To use specific passwords, set SEED_ADMIN_PASSWORD and SEED_STAFF_PASSWORD environment variables.');

  } catch (err) {
    console.error('\n❌ Seed failed:', err);
    process.exit(1);
  }
}

seed();
