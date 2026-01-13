import express from 'express';
import supabase from '../services/supabase.js';
import { sendSuccess, errors } from '../middleware/correlationId.js';
import { requireAdmin, requireStaff } from '../middleware/auth.js';
import { auditLog, getAuditContext, recordSystemEvent } from '../services/audit.js';
import { fingerprintTitle, normalizeAsin, normalizeSku } from '../utils/identityNormalization.js';
import crypto from 'crypto';

const router = express.Router();

/**
 * GET /review
 * Get all items in the review queue
 */
router.get('/', async (req, res) => {
  const { status = 'PENDING', limit = 50, offset = 0 } = req.query;

  try {
    let query = supabase
      .from('review_queue')
      .select(`
        *,
        orders (
          id,
          external_order_id,
          customer_name
        )
      `, { count: 'exact' })
      .order('created_at', { ascending: false });

    if (status !== 'ALL') {
      query = query.eq('status', status);
    }

    const { data, error, count } = await query.range(
      parseInt(offset),
      parseInt(offset) + parseInt(limit) - 1
    );

    if (error) {
      console.error('Review queue fetch error:', error);
      return errors.internal(res, 'Failed to fetch review queue');
    }

    sendSuccess(res, {
      items: data,
      total: count,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (err) {
    console.error('Review queue fetch error:', err);
    errors.internal(res, 'Failed to fetch review queue');
  }
});

/**
 * GET /review/stats/summary
 * Get review queue statistics
 */
router.get('/stats/summary', async (req, res) => {
  try {
    const [pending, resolved, skipped] = await Promise.all([
      supabase.from('review_queue').select('*', { count: 'exact', head: true }).eq('status', 'PENDING'),
      supabase.from('review_queue').select('*', { count: 'exact', head: true }).eq('status', 'RESOLVED'),
      supabase.from('review_queue').select('*', { count: 'exact', head: true }).eq('status', 'SKIPPED')
    ]);

    // Get oldest pending
    const { data: oldest } = await supabase
      .from('review_queue')
      .select('created_at')
      .eq('status', 'PENDING')
      .order('created_at', { ascending: true })
      .limit(1);

    const oldestAge = oldest?.[0]?.created_at
      ? Math.floor((Date.now() - new Date(oldest[0].created_at).getTime()) / (1000 * 60 * 60))
      : 0;

    sendSuccess(res, {
      pending: pending.count || 0,
      resolved: resolved.count || 0,
      skipped: skipped.count || 0,
      oldest_pending_hours: oldestAge
    });
  } catch (err) {
    console.error('Review stats error:', err);
    errors.internal(res, 'Failed to fetch review statistics');
  }
});

/**
 * GET /review/:id
 * Get a single review item with details
 */
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from('review_queue')
      .select(`
        *,
        orders (
          id,
          external_order_id,
          customer_name,
          customer_email
        )
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return errors.notFound(res, 'Review item');
      }
      console.error('Review item fetch error:', error);
      return errors.internal(res, 'Failed to fetch review item');
    }

    // Get suggested BOMs based on parse_intent if available
    let suggestedBoms = [];
    if (data.parse_intent) {
      const { data: rules } = await supabase
        .from('intent_to_bom_rules')
        .select(`
          *,
          boms (
            id,
            bundle_sku,
            description
          )
        `)
        .eq('is_active', true);

      // Simple matching based on parse_intent
      for (const rule of rules || []) {
        let matchScore = 0;
        if (data.parse_intent.battery_qty === rule.battery_qty) matchScore++;
        if (data.parse_intent.charger_included === rule.charger_included) matchScore++;
        if (data.parse_intent.case_included === rule.case_included) matchScore++;
        if (data.parse_intent.bare_tool === rule.bare_tool) matchScore++;

        if (matchScore > 0) {
          suggestedBoms.push({
            bom: rule.boms,
            match_score: matchScore,
            rule_name: rule.rule_name
          });
        }
      }

      suggestedBoms.sort((a, b) => b.match_score - a.match_score);
    }

    sendSuccess(res, {
      ...data,
      suggested_boms: suggestedBoms.slice(0, 5)
    });
  } catch (err) {
    console.error('Review item fetch error:', err);
    errors.internal(res, 'Failed to fetch review item');
  }
});

/**
 * POST /review/:id/resolve
 * Resolve a review item by assigning a BOM
 * Optionally save as a rule for future automatic resolution
 * ADMIN only
 */
router.post('/:id/resolve', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { bom_id, save_as_rule = false, identity_overrides, note } = req.body;

  if (!bom_id) {
    return errors.badRequest(res, 'bom_id is required');
  }

  try {
    // Get the review item
    const { data: review, error: reviewError } = await supabase
      .from('review_queue')
      .select('*')
      .eq('id', id)
      .single();

    if (reviewError) {
      if (reviewError.code === 'PGRST116') {
        return errors.notFound(res, 'Review item');
      }
      throw reviewError;
    }

    if (review.status !== 'PENDING') {
      return errors.invalidStatus(res, 'Review item has already been resolved', {
        current_status: review.status
      });
    }

    // Verify BOM exists
    const { data: bom, error: bomError } = await supabase
      .from('boms')
      .select('id, bundle_sku, description')
      .eq('id', bom_id)
      .single();

    if (bomError || !bom) {
      return errors.notFound(res, 'BOM');
    }

    // Determine identities to use
    const asin = identity_overrides?.asin !== undefined
      ? normalizeAsin(identity_overrides.asin)
      : normalizeAsin(review.asin);

    const sku = identity_overrides?.sku !== undefined
      ? normalizeSku(identity_overrides.sku)
      : normalizeSku(review.sku);

    const titleForFingerprint = identity_overrides?.title || review.title;
    const fingerprint = fingerprintTitle(titleForFingerprint);
    const fingerprintHash = fingerprint
      ? crypto.createHash('sha256').update(fingerprint).digest('hex')
      : null;

    let newMemory = null;

    // If save_as_rule, create or update listing_memory
    if (save_as_rule) {
      // Check for existing active rules that would conflict
      const conflicts = [];

      if (asin) {
        const { data: existingAsin } = await supabase
          .from('listing_memory')
          .select('id, asin, bom_id')
          .eq('asin', asin)
          .eq('is_active', true)
          .maybeSingle();

        if (existingAsin) {
          conflicts.push({ type: 'ASIN', existing: existingAsin });
        }
      }

      if (sku) {
        const { data: existingSku } = await supabase
          .from('listing_memory')
          .select('id, sku, bom_id')
          .eq('sku', sku)
          .eq('is_active', true)
          .maybeSingle();

        if (existingSku && existingSku.id !== conflicts[0]?.existing?.id) {
          conflicts.push({ type: 'SKU', existing: existingSku });
        }
      }

      if (fingerprintHash) {
        const { data: existingFingerprint } = await supabase
          .from('listing_memory')
          .select('id, title_fingerprint, bom_id')
          .eq('title_fingerprint_hash', fingerprintHash)
          .eq('is_active', true)
          .maybeSingle();

        if (existingFingerprint &&
            existingFingerprint.id !== conflicts[0]?.existing?.id &&
            existingFingerprint.id !== conflicts[1]?.existing?.id) {
          conflicts.push({ type: 'FINGERPRINT', existing: existingFingerprint });
        }
      }

      // Supersede any conflicting rules
      for (const conflict of conflicts) {
        // Get the full record for audit
        const { data: oldRecord } = await supabase
          .from('listing_memory')
          .select('*')
          .eq('id', conflict.existing.id)
          .single();

        await supabase
          .from('listing_memory')
          .update({
            is_active: false,
            superseded_at: new Date().toISOString()
          })
          .eq('id', conflict.existing.id);

        await auditLog({
          entityType: 'LISTING_MEMORY',
          entityId: conflict.existing.id,
          action: 'SUPERSEDE',
          beforeJson: oldRecord,
          changesSummary: `Superseded by new rule for ${conflict.type}`,
          ...getAuditContext(req)
        });
      }

      // Create new memory rule
      const { data: memoryRecord, error: memoryError } = await supabase
        .from('listing_memory')
        .insert({
          asin: asin,
          sku: sku,
          title_fingerprint: fingerprint,
          title_fingerprint_hash: fingerprintHash,
          bom_id: bom_id,
          resolution_source: 'MANUAL',
          is_active: true,
          created_by_actor_type: req.actor.type,
          created_by_actor_id: req.actor.id,
          created_by_actor_display: req.actor.display
        })
        .select()
        .single();

      if (memoryError) {
        console.error('Memory create error:', memoryError);
        return errors.internal(res, 'Failed to create memory rule');
      }

      newMemory = memoryRecord;

      // Update any superseded records to point to the new one
      for (const conflict of conflicts) {
        await supabase
          .from('listing_memory')
          .update({ superseded_by: newMemory.id })
          .eq('id', conflict.existing.id);
      }

      await auditLog({
        entityType: 'LISTING_MEMORY',
        entityId: newMemory.id,
        action: 'CREATE',
        afterJson: newMemory,
        changesSummary: `Created from review resolution: ${asin || sku || 'fingerprint'}`,
        ...getAuditContext(req)
      });
    }

    // Update the review queue item
    await supabase
      .from('review_queue')
      .update({
        status: 'RESOLVED',
        resolved_at: new Date().toISOString(),
        resolved_by_actor_type: req.actor.type,
        resolved_by_actor_id: req.actor.id,
        resolved_by_actor_display: req.actor.display,
        resolution_bom_id: bom_id,
        resolution_note: note
      })
      .eq('id', id);

    // Update affected order lines
    if (review.order_id) {
      // Find and update unresolved lines for this order
      const { data: matchingLines } = await supabase
        .from('order_lines')
        .select('id')
        .eq('order_id', review.order_id)
        .eq('is_resolved', false);

      for (const line of matchingLines || []) {
        await supabase
          .from('order_lines')
          .update({
            bom_id: bom_id,
            listing_memory_id: newMemory?.id || null,
            is_resolved: true,
            resolution_source: save_as_rule ? 'REVIEW_WITH_RULE' : 'REVIEW'
          })
          .eq('id', line.id);
      }

      // Re-evaluate order readiness
      await supabase.rpc('rpc_evaluate_order_readiness', {
        p_order_id: review.order_id
      });
    }

    await recordSystemEvent({
      eventType: 'REVIEW_RESOLVED',
      entityType: 'REVIEW',
      entityId: id,
      description: `Review resolved: ${review.title?.substring(0, 50)}...`,
      metadata: {
        bom_id,
        bom_sku: bom.bundle_sku,
        save_as_rule,
        memory_id: newMemory?.id
      }
    });

    sendSuccess(res, {
      resolved: true,
      bom: bom,
      memory_created: newMemory ? {
        id: newMemory.id,
        asin: newMemory.asin,
        sku: newMemory.sku,
        title_fingerprint: newMemory.title_fingerprint
      } : null
    });
  } catch (err) {
    console.error('Review resolve error:', err);
    errors.internal(res, 'Failed to resolve review item');
  }
});

/**
 * POST /review/:id/skip
 * Skip a review item (mark as skipped, can be revisited)
 */
router.post('/:id/skip', requireStaff, async (req, res) => {
  const { id } = req.params;
  const { note } = req.body;

  try {
    const { data: review, error: fetchError } = await supabase
      .from('review_queue')
      .select('id, status')
      .eq('id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return errors.notFound(res, 'Review item');
      }
      throw fetchError;
    }

    if (review.status !== 'PENDING') {
      return errors.invalidStatus(res, 'Review item is not in PENDING status');
    }

    await supabase
      .from('review_queue')
      .update({
        status: 'SKIPPED',
        resolution_note: note
      })
      .eq('id', id);

    sendSuccess(res, { skipped: true });
  } catch (err) {
    console.error('Review skip error:', err);
    errors.internal(res, 'Failed to skip review item');
  }
});

/**
 * POST /review/:id/requeue
 * Put a skipped or resolved item back in the queue
 * ADMIN only
 */
router.post('/:id/requeue', requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const { data: review, error: fetchError } = await supabase
      .from('review_queue')
      .select('id, status')
      .eq('id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return errors.notFound(res, 'Review item');
      }
      throw fetchError;
    }

    if (review.status === 'PENDING') {
      return errors.badRequest(res, 'Review item is already in PENDING status');
    }

    await supabase
      .from('review_queue')
      .update({
        status: 'PENDING',
        resolved_at: null,
        resolved_by_actor_type: null,
        resolved_by_actor_id: null,
        resolved_by_actor_display: null,
        resolution_bom_id: null,
        resolution_note: null
      })
      .eq('id', id);

    sendSuccess(res, { requeued: true });
  } catch (err) {
    console.error('Review requeue error:', err);
    errors.internal(res, 'Failed to requeue review item');
  }
});

export default router;
