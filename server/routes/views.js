import express from 'express';
import supabase from '../services/supabase.js';
import { sendSuccess, errors } from '../middleware/correlationId.js';
import { requireAdmin, requireStaff } from '../middleware/auth.js';
import { auditLog, getAuditContext } from '../services/audit.js';

const router = express.Router();

// Valid contexts for views
const VALID_CONTEXTS = ['components', 'listings', 'orders', 'boms', 'returns'];

/**
 * GET /views
 * Returns all views for a given context
 * Query params:
 *   - context: required, one of VALID_CONTEXTS
 */
router.get('/', async (req, res) => {
  const { context } = req.query;

  if (!context) {
    return errors.badRequest(res, 'context query parameter is required');
  }

  if (!VALID_CONTEXTS.includes(context)) {
    return errors.badRequest(res, `Invalid context. Valid values: ${VALID_CONTEXTS.join(', ')}`);
  }

  try {
    const { data, error } = await supabase
      .from('ui_views')
      .select(`
        id,
        context,
        name,
        config_json,
        is_default,
        sort_order,
        created_by_user_id,
        created_at,
        updated_at
      `)
      .eq('context', context)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('Views fetch error:', error);
      return errors.internal(res, 'Failed to fetch views');
    }

    sendSuccess(res, {
      views: data || [],
      context,
    });
  } catch (err) {
    console.error('Views fetch error:', err);
    errors.internal(res, 'Failed to fetch views');
  }
});

/**
 * GET /views/:id
 * Returns a single view by ID
 */
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from('ui_views')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return errors.notFound(res, 'View');
      }
      console.error('View fetch error:', error);
      return errors.internal(res, 'Failed to fetch view');
    }

    sendSuccess(res, data);
  } catch (err) {
    console.error('View fetch error:', err);
    errors.internal(res, 'Failed to fetch view');
  }
});

/**
 * POST /views
 * Create a new view
 * Staff can create views
 */
router.post('/', requireStaff, async (req, res) => {
  const { context, name, config_json, is_default = false, sort_order } = req.body;

  if (!context) {
    return errors.badRequest(res, 'context is required');
  }

  if (!VALID_CONTEXTS.includes(context)) {
    return errors.badRequest(res, `Invalid context. Valid values: ${VALID_CONTEXTS.join(', ')}`);
  }

  if (!name || !name.trim()) {
    return errors.badRequest(res, 'name is required');
  }

  try {
    // If setting as default, unset any existing default for this context
    if (is_default) {
      await supabase
        .from('ui_views')
        .update({ is_default: false })
        .eq('context', context)
        .eq('is_default', true);
    }

    // Calculate sort_order if not provided
    let finalSortOrder = sort_order;
    if (finalSortOrder === undefined || finalSortOrder === null) {
      const { data: maxOrderData } = await supabase
        .from('ui_views')
        .select('sort_order')
        .eq('context', context)
        .order('sort_order', { ascending: false })
        .limit(1);

      finalSortOrder = (maxOrderData?.[0]?.sort_order ?? -1) + 1;
    }

    const { data, error } = await supabase
      .from('ui_views')
      .insert({
        context,
        name: name.trim(),
        config_json: config_json || {},
        is_default,
        sort_order: finalSortOrder,
        created_by_user_id: req.user?.id || null,
      })
      .select()
      .single();

    if (error) {
      console.error('View create error:', error);
      return errors.internal(res, 'Failed to create view');
    }

    await auditLog({
      entityType: 'UI_VIEW',
      entityId: data.id,
      action: 'CREATE',
      afterJson: data,
      changesSummary: `Created view "${data.name}" for ${data.context}`,
      ...getAuditContext(req),
    });

    sendSuccess(res, data, 201);
  } catch (err) {
    console.error('View create error:', err);
    errors.internal(res, 'Failed to create view');
  }
});

/**
 * PUT /views/:id
 * Update a view
 * Staff can update views
 */
router.put('/:id', requireStaff, async (req, res) => {
  const { id } = req.params;
  const { name, config_json, is_default, sort_order } = req.body;

  try {
    // Get current view for audit
    const { data: current, error: fetchError } = await supabase
      .from('ui_views')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return errors.notFound(res, 'View');
      }
      throw fetchError;
    }

    // If setting as default, unset any existing default for this context
    if (is_default && !current.is_default) {
      await supabase
        .from('ui_views')
        .update({ is_default: false })
        .eq('context', current.context)
        .eq('is_default', true);
    }

    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (config_json !== undefined) updates.config_json = config_json;
    if (is_default !== undefined) updates.is_default = is_default;
    if (sort_order !== undefined) updates.sort_order = sort_order;

    const { data, error } = await supabase
      .from('ui_views')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('View update error:', error);
      return errors.internal(res, 'Failed to update view');
    }

    await auditLog({
      entityType: 'UI_VIEW',
      entityId: id,
      action: 'UPDATE',
      beforeJson: current,
      afterJson: data,
      changesSummary: `Updated view "${data.name}"`,
      ...getAuditContext(req),
    });

    sendSuccess(res, data);
  } catch (err) {
    console.error('View update error:', err);
    errors.internal(res, 'Failed to update view');
  }
});

/**
 * DELETE /views/:id
 * Delete a view
 * Admin required to delete
 */
router.delete('/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    // Get current view for audit
    const { data: current, error: fetchError } = await supabase
      .from('ui_views')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return errors.notFound(res, 'View');
      }
      throw fetchError;
    }

    const { error } = await supabase
      .from('ui_views')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('View delete error:', error);
      return errors.internal(res, 'Failed to delete view');
    }

    await auditLog({
      entityType: 'UI_VIEW',
      entityId: id,
      action: 'DELETE',
      beforeJson: current,
      changesSummary: `Deleted view "${current.name}" from ${current.context}`,
      ...getAuditContext(req),
    });

    sendSuccess(res, { deleted: true, id });
  } catch (err) {
    console.error('View delete error:', err);
    errors.internal(res, 'Failed to delete view');
  }
});

/**
 * POST /views/reorder
 * Reorder views for a context
 * Staff can reorder views
 */
router.post('/reorder', requireStaff, async (req, res) => {
  const { context, view_ids } = req.body;

  if (!context || !VALID_CONTEXTS.includes(context)) {
    return errors.badRequest(res, `Invalid context. Valid values: ${VALID_CONTEXTS.join(', ')}`);
  }

  if (!Array.isArray(view_ids) || view_ids.length === 0) {
    return errors.badRequest(res, 'view_ids array is required');
  }

  try {
    // Update sort_order for each view
    const updates = view_ids.map((viewId, index) =>
      supabase
        .from('ui_views')
        .update({ sort_order: index })
        .eq('id', viewId)
        .eq('context', context)
    );

    await Promise.all(updates);

    // Fetch updated views
    const { data, error } = await supabase
      .from('ui_views')
      .select('*')
      .eq('context', context)
      .order('sort_order', { ascending: true });

    if (error) {
      throw error;
    }

    sendSuccess(res, {
      views: data || [],
      context,
    });
  } catch (err) {
    console.error('Views reorder error:', err);
    errors.internal(res, 'Failed to reorder views');
  }
});

export default router;
