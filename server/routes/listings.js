import express from 'express';
import crypto from 'crypto';
import supabase from '../services/supabase.js';
import { sendSuccess, errors } from '../middleware/correlationId.js';
import { requireAdmin, requireStaff } from '../middleware/auth.js';
import { auditLog, getAuditContext } from '../services/audit.js';
import { fingerprintTitle, normalizeAsin, normalizeSku } from '../utils/identityNormalization.js';

const router = express.Router();

/**
 * GET /listings
 * Returns all listing memory entries
 */
router.get('/', async (req, res) => {
  const { active_only = 'true', bom_id, limit = 100, offset = 0 } = req.query;

  try {
    let query = supabase
      .from('listing_memory')
      .select(`
        *,
        boms (
          id,
          bundle_sku,
          description
        )
      `, { count: 'exact' })
      .order('created_at', { ascending: false });

    if (active_only === 'true') {
      query = query.eq('is_active', true);
    }

    if (bom_id) {
      query = query.eq('bom_id', bom_id);
    }

    const { data, error, count } = await query.range(
      parseInt(offset),
      parseInt(offset) + parseInt(limit) - 1
    );

    if (error) {
      console.error('Listings fetch error:', error);
      return errors.internal(res, 'Failed to fetch listings');
    }

    sendSuccess(res, {
      listings: data,
      total: count,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (err) {
    console.error('Listings fetch error:', err);
    errors.internal(res, 'Failed to fetch listings');
  }
});

/**
 * GET /listings/:id
 * Get a single listing memory entry
 */
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from('listing_memory')
      .select(`
        *,
        boms (
          id,
          bundle_sku,
          description,
          bom_components (
            qty_required,
            components (
              id,
              internal_sku,
              description
            )
          )
        ),
        superseded_listing:superseded_by (
          id,
          asin,
          sku
        )
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return errors.notFound(res, 'Listing');
      }
      console.error('Listing fetch error:', error);
      return errors.internal(res, 'Failed to fetch listing');
    }

    sendSuccess(res, data);
  } catch (err) {
    console.error('Listing fetch error:', err);
    errors.internal(res, 'Failed to fetch listing');
  }
});

/**
 * POST /listings
 * Create a new listing memory entry
 * ADMIN only
 */
router.post('/', requireAdmin, async (req, res) => {
  const { asin, sku, title, bom_id } = req.body;

  if (!asin && !sku && !title) {
    return errors.badRequest(res, 'At least one of asin, sku, or title must be provided');
  }

  const normalizedAsin = normalizeAsin(asin);
  const normalizedSku = normalizeSku(sku);
  const fingerprint = fingerprintTitle(title);
  const fingerprintHash = fingerprint
    ? crypto.createHash('sha256').update(fingerprint).digest('hex')
    : null;

  try {
    // Check for conflicts with existing active entries
    const conflicts = [];

    if (normalizedAsin) {
      const { data: existingAsin } = await supabase
        .from('listing_memory')
        .select('id, asin')
        .eq('asin', normalizedAsin)
        .eq('is_active', true)
        .maybeSingle();

      if (existingAsin) {
        conflicts.push({ type: 'ASIN', existing_id: existingAsin.id });
      }
    }

    if (normalizedSku) {
      const { data: existingSku } = await supabase
        .from('listing_memory')
        .select('id, sku')
        .eq('sku', normalizedSku)
        .eq('is_active', true)
        .maybeSingle();

      if (existingSku && existingSku.id !== conflicts[0]?.existing_id) {
        conflicts.push({ type: 'SKU', existing_id: existingSku.id });
      }
    }

    if (fingerprintHash) {
      const { data: existingFp } = await supabase
        .from('listing_memory')
        .select('id, title_fingerprint')
        .eq('title_fingerprint_hash', fingerprintHash)
        .eq('is_active', true)
        .maybeSingle();

      if (existingFp && !conflicts.some(c => c.existing_id === existingFp.id)) {
        conflicts.push({ type: 'FINGERPRINT', existing_id: existingFp.id });
      }
    }

    if (conflicts.length > 0) {
      return errors.conflict(res, 'Active listing memory entries already exist for these identities', {
        conflicts
      });
    }

    // Verify BOM exists if provided
    if (bom_id) {
      const { data: bom, error: bomError } = await supabase
        .from('boms')
        .select('id')
        .eq('id', bom_id)
        .single();

      if (bomError || !bom) {
        return errors.notFound(res, 'BOM');
      }
    }

    // Create the listing memory entry
    const { data, error } = await supabase
      .from('listing_memory')
      .insert({
        asin: normalizedAsin,
        sku: normalizedSku,
        title_fingerprint: fingerprint,
        title_fingerprint_hash: fingerprintHash,
        bom_id: bom_id || null,
        resolution_source: 'MANUAL',
        is_active: true,
        created_by_actor_type: req.actor.type,
        created_by_actor_id: req.actor.id,
        created_by_actor_display: req.actor.display
      })
      .select(`
        *,
        boms (
          id,
          bundle_sku,
          description
        )
      `)
      .single();

    if (error) {
      console.error('Listing create error:', error);
      return errors.internal(res, 'Failed to create listing');
    }

    await auditLog({
      entityType: 'LISTING_MEMORY',
      entityId: data.id,
      action: 'CREATE',
      afterJson: data,
      changesSummary: `Created listing memory: ${normalizedAsin || normalizedSku || fingerprint?.substring(0, 30)}`,
      ...getAuditContext(req)
    });

    sendSuccess(res, data, 201);
  } catch (err) {
    console.error('Listing create error:', err);
    errors.internal(res, 'Failed to create listing');
  }
});

/**
 * PUT /listings/:id
 * Update a listing memory entry (primarily to change BOM assignment)
 * ADMIN only
 */
router.put('/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { bom_id, is_active } = req.body;

  try {
    // Get current state
    const { data: current, error: fetchError } = await supabase
      .from('listing_memory')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return errors.notFound(res, 'Listing');
      }
      throw fetchError;
    }

    // Verify BOM exists if provided
    if (bom_id) {
      const { data: bom, error: bomError } = await supabase
        .from('boms')
        .select('id')
        .eq('id', bom_id)
        .single();

      if (bomError || !bom) {
        return errors.notFound(res, 'BOM');
      }
    }

    const updates = {};
    if (bom_id !== undefined) updates.bom_id = bom_id;
    if (is_active !== undefined) updates.is_active = is_active;

    const { data, error } = await supabase
      .from('listing_memory')
      .update(updates)
      .eq('id', id)
      .select(`
        *,
        boms (
          id,
          bundle_sku,
          description
        )
      `)
      .single();

    if (error) {
      console.error('Listing update error:', error);
      return errors.internal(res, 'Failed to update listing');
    }

    await auditLog({
      entityType: 'LISTING_MEMORY',
      entityId: id,
      action: 'UPDATE',
      beforeJson: current,
      afterJson: data,
      changesSummary: `Updated listing memory`,
      ...getAuditContext(req)
    });

    sendSuccess(res, data);
  } catch (err) {
    console.error('Listing update error:', err);
    errors.internal(res, 'Failed to update listing');
  }
});

/**
 * POST /listings/:id/supersede
 * Supersede a listing memory entry with a new one
 * ADMIN only
 */
router.post('/:id/supersede', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { asin, sku, title, bom_id, note } = req.body;

  try {
    // Get current listing
    const { data: current, error: fetchError } = await supabase
      .from('listing_memory')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return errors.notFound(res, 'Listing');
      }
      throw fetchError;
    }

    if (!current.is_active) {
      return errors.badRequest(res, 'Listing is already inactive');
    }

    // Use provided values or fall back to current
    const normalizedAsin = asin !== undefined ? normalizeAsin(asin) : current.asin;
    const normalizedSku = sku !== undefined ? normalizeSku(sku) : current.sku;
    const fingerprint = title !== undefined ? fingerprintTitle(title) : current.title_fingerprint;
    const fingerprintHash = fingerprint
      ? crypto.createHash('sha256').update(fingerprint).digest('hex')
      : null;
    const newBomId = bom_id !== undefined ? bom_id : current.bom_id;

    // Create new listing
    const { data: newListing, error: createError } = await supabase
      .from('listing_memory')
      .insert({
        asin: normalizedAsin,
        sku: normalizedSku,
        title_fingerprint: fingerprint,
        title_fingerprint_hash: fingerprintHash,
        bom_id: newBomId,
        resolution_source: 'SUPERSEDE',
        is_active: true,
        created_by_actor_type: req.actor.type,
        created_by_actor_id: req.actor.id,
        created_by_actor_display: req.actor.display
      })
      .select()
      .single();

    if (createError) {
      console.error('New listing create error:', createError);
      return errors.internal(res, 'Failed to create new listing');
    }

    // Deactivate old listing
    await supabase
      .from('listing_memory')
      .update({
        is_active: false,
        superseded_by: newListing.id,
        superseded_at: new Date().toISOString()
      })
      .eq('id', id);

    await auditLog({
      entityType: 'LISTING_MEMORY',
      entityId: id,
      action: 'SUPERSEDE',
      beforeJson: current,
      changesSummary: `Superseded by ${newListing.id}${note ? ': ' + note : ''}`,
      ...getAuditContext(req)
    });

    await auditLog({
      entityType: 'LISTING_MEMORY',
      entityId: newListing.id,
      action: 'CREATE',
      afterJson: newListing,
      changesSummary: `Created as supersession of ${id}`,
      ...getAuditContext(req)
    });

    sendSuccess(res, {
      superseded: {
        id: current.id,
        asin: current.asin,
        sku: current.sku
      },
      new_listing: newListing
    });
  } catch (err) {
    console.error('Listing supersede error:', err);
    errors.internal(res, 'Failed to supersede listing');
  }
});

/**
 * GET /listings/search
 * Search for listings by ASIN, SKU, or title
 */
router.get('/search/query', async (req, res) => {
  const { q, active_only = 'true' } = req.query;

  if (!q || q.length < 2) {
    return errors.badRequest(res, 'Search query must be at least 2 characters');
  }

  try {
    const searchTerm = q.toUpperCase().trim();

    let query = supabase
      .from('listing_memory')
      .select(`
        *,
        boms (
          id,
          bundle_sku,
          description
        )
      `)
      .or(`asin.ilike.%${searchTerm}%,sku.ilike.%${searchTerm}%,title_fingerprint.ilike.%${searchTerm}%`)
      .order('created_at', { ascending: false })
      .limit(50);

    if (active_only === 'true') {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Listing search error:', error);
      return errors.internal(res, 'Failed to search listings');
    }

    sendSuccess(res, data || []);
  } catch (err) {
    console.error('Listing search error:', err);
    errors.internal(res, 'Failed to search listings');
  }
});

export default router;
