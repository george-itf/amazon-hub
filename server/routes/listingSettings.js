import express from 'express';
import supabase from '../services/supabase.js';
import { sendSuccess, errors } from '../middleware/correlationId.js';
import { requireStaff } from '../middleware/auth.js';
import { auditLog, getAuditContext } from '../services/audit.js';

const router = express.Router();

/**
 * GET /listing-settings
 * Returns listing settings for specified IDs or all active listings
 * Query params:
 *   - listing_memory_ids: comma-separated UUIDs (optional)
 */
router.get('/', async (req, res) => {
  const { listing_memory_ids } = req.query;

  try {
    let query = supabase
      .from('listing_settings')
      .select(`
        id,
        listing_memory_id,
        price_override_pence,
        quantity_cap,
        quantity_override,
        min_margin_override,
        target_margin_override,
        shipping_profile_id,
        tags,
        group_key,
        created_at,
        updated_at
      `);

    if (listing_memory_ids) {
      const ids = listing_memory_ids.split(',').map(id => id.trim()).filter(Boolean);
      if (ids.length > 0) {
        query = query.in('listing_memory_id', ids);
      }
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      console.error('Listing settings fetch error:', error);
      return errors.internal(res, 'Failed to fetch listing settings');
    }

    sendSuccess(res, {
      settings: data || [],
      count: data?.length || 0,
    });
  } catch (err) {
    console.error('Listing settings fetch error:', err);
    errors.internal(res, 'Failed to fetch listing settings');
  }
});

/**
 * GET /listing-settings/:listingMemoryId
 * Returns settings for a single listing
 */
router.get('/:listingMemoryId', async (req, res) => {
  const { listingMemoryId } = req.params;

  try {
    const { data, error } = await supabase
      .from('listing_settings')
      .select('*')
      .eq('listing_memory_id', listingMemoryId)
      .maybeSingle();

    if (error) {
      console.error('Listing setting fetch error:', error);
      return errors.internal(res, 'Failed to fetch listing setting');
    }

    // Return null data if not found (not an error)
    sendSuccess(res, data || { listing_memory_id: listingMemoryId });
  } catch (err) {
    console.error('Listing setting fetch error:', err);
    errors.internal(res, 'Failed to fetch listing setting');
  }
});

/**
 * PUT /listing-settings/:listingMemoryId
 * UPSERT listing settings (create or update)
 */
router.put('/:listingMemoryId', requireStaff, async (req, res) => {
  const { listingMemoryId } = req.params;
  const {
    price_override_pence,
    quantity_cap,
    quantity_override,
    min_margin_override,
    target_margin_override,
    shipping_profile_id,
    tags,
    group_key,
  } = req.body;

  // Validate inputs
  if (price_override_pence !== undefined && price_override_pence !== null) {
    if (!Number.isInteger(price_override_pence) || price_override_pence < 0) {
      return errors.badRequest(res, 'price_override_pence must be a non-negative integer');
    }
  }

  if (quantity_cap !== undefined && quantity_cap !== null) {
    if (!Number.isInteger(quantity_cap) || quantity_cap < 0) {
      return errors.badRequest(res, 'quantity_cap must be a non-negative integer');
    }
  }

  if (quantity_override !== undefined && quantity_override !== null) {
    if (!Number.isInteger(quantity_override) || quantity_override < 0) {
      return errors.badRequest(res, 'quantity_override must be a non-negative integer');
    }
  }

  if (min_margin_override !== undefined && min_margin_override !== null) {
    const num = parseFloat(min_margin_override);
    if (isNaN(num) || num < 10 || num > 100) {
      return errors.badRequest(res, 'min_margin_override must be between 10 and 100 (10% minimum margin guardrail)');
    }
  }

  if (target_margin_override !== undefined && target_margin_override !== null) {
    const num = parseFloat(target_margin_override);
    if (isNaN(num) || num < 0 || num > 100) {
      return errors.badRequest(res, 'target_margin_override must be between 0 and 100');
    }
  }

  if (tags !== undefined && tags !== null) {
    if (!Array.isArray(tags)) {
      return errors.badRequest(res, 'tags must be an array of strings');
    }
    if (!tags.every(t => typeof t === 'string')) {
      return errors.badRequest(res, 'All tags must be strings');
    }
  }

  try {
    // Check if listing_memory exists
    const { data: listing, error: listingError } = await supabase
      .from('listing_memory')
      .select('id, asin, sku')
      .eq('id', listingMemoryId)
      .single();

    if (listingError || !listing) {
      return errors.notFound(res, 'Listing');
    }

    // Check if settings already exist
    const { data: existing } = await supabase
      .from('listing_settings')
      .select('id')
      .eq('listing_memory_id', listingMemoryId)
      .maybeSingle();

    const payload = {
      listing_memory_id: listingMemoryId,
      price_override_pence: price_override_pence ?? null,
      quantity_cap: quantity_cap ?? null,
      quantity_override: quantity_override ?? null,
      min_margin_override: min_margin_override ?? null,
      target_margin_override: target_margin_override ?? null,
      shipping_profile_id: shipping_profile_id ?? null,
      tags: tags ?? [],
      group_key: group_key ?? null,
    };

    let data;
    let error;
    let action;

    if (existing) {
      // Update existing
      const result = await supabase
        .from('listing_settings')
        .update(payload)
        .eq('listing_memory_id', listingMemoryId)
        .select()
        .single();

      data = result.data;
      error = result.error;
      action = 'UPDATE';
    } else {
      // Insert new
      const result = await supabase
        .from('listing_settings')
        .insert(payload)
        .select()
        .single();

      data = result.data;
      error = result.error;
      action = 'CREATE';
    }

    if (error) {
      console.error('Listing settings upsert error:', error);
      return errors.internal(res, 'Failed to save listing settings');
    }

    await auditLog({
      entityType: 'LISTING_SETTINGS',
      entityId: data.id.toString(),
      action,
      beforeJson: existing || null,
      afterJson: data,
      changesSummary: `${action === 'CREATE' ? 'Created' : 'Updated'} settings for listing ${listing.asin || listing.sku || listingMemoryId}`,
      ...getAuditContext(req),
    });

    sendSuccess(res, data, existing ? 200 : 201);
  } catch (err) {
    console.error('Listing settings upsert error:', err);
    errors.internal(res, 'Failed to save listing settings');
  }
});

/**
 * DELETE /listing-settings/:listingMemoryId
 * Delete listing settings
 */
router.delete('/:listingMemoryId', requireStaff, async (req, res) => {
  const { listingMemoryId } = req.params;

  try {
    const { data: existing, error: fetchError } = await supabase
      .from('listing_settings')
      .select('*')
      .eq('listing_memory_id', listingMemoryId)
      .maybeSingle();

    if (fetchError) {
      throw fetchError;
    }

    if (!existing) {
      return errors.notFound(res, 'Listing settings');
    }

    const { error } = await supabase
      .from('listing_settings')
      .delete()
      .eq('listing_memory_id', listingMemoryId);

    if (error) {
      console.error('Listing settings delete error:', error);
      return errors.internal(res, 'Failed to delete listing settings');
    }

    await auditLog({
      entityType: 'LISTING_SETTINGS',
      entityId: existing.id.toString(),
      action: 'DELETE',
      beforeJson: existing,
      changesSummary: `Deleted settings for listing ${listingMemoryId}`,
      ...getAuditContext(req),
    });

    sendSuccess(res, { deleted: true, listing_memory_id: listingMemoryId });
  } catch (err) {
    console.error('Listing settings delete error:', err);
    errors.internal(res, 'Failed to delete listing settings');
  }
});

/**
 * GET /listing-settings/by-group/:groupKey
 * Get all listings in a group
 */
router.get('/by-group/:groupKey', async (req, res) => {
  const { groupKey } = req.params;

  try {
    const { data, error } = await supabase
      .from('listing_settings')
      .select(`
        *,
        listing_memory:listing_memory_id (
          id,
          asin,
          sku,
          bom_id,
          is_active
        )
      `)
      .eq('group_key', groupKey);

    if (error) {
      console.error('Group fetch error:', error);
      return errors.internal(res, 'Failed to fetch group listings');
    }

    sendSuccess(res, {
      group_key: groupKey,
      settings: data || [],
      count: data?.length || 0,
    });
  } catch (err) {
    console.error('Group fetch error:', err);
    errors.internal(res, 'Failed to fetch group listings');
  }
});

export default router;
