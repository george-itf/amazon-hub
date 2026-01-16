import express from 'express';
import supabase from '../services/supabase.js';
import { sendSuccess, errors } from '../middleware/correlationId.js';
import { requireStaff } from '../middleware/auth.js';
import { auditLog, getAuditContext } from '../services/audit.js';

const router = express.Router();

// Valid pages for saved views
const VALID_PAGES = [
  'shipping',
  'listings',
  'inventory',
  'components',
  'orders',
  'boms',
  'returns',
  'analytics',
  'review'
];

// Legacy context mapping for backwards compatibility
const CONTEXT_TO_PAGE = {
  'components': 'components',
  'listings': 'listings'
};

/**
 * Helper to get user ID from request
 * Uses req.user.id if available, falls back to extracting from token
 */
function getUserId(req) {
  return req.user?.id || req.user?.sub || null;
}

/**
 * GET /views?page=shipping (or context=components for legacy)
 * Returns views for a given page: user's personal views + shared views
 * Always prepends a virtual "All" view
 */
router.get('/', async (req, res) => {
  // Support both 'page' and legacy 'context' parameter
  let page = req.query.page || CONTEXT_TO_PAGE[req.query.context] || req.query.context;

  if (!page) {
    return errors.badRequest(res, 'page query parameter is required');
  }

  if (!VALID_PAGES.includes(page)) {
    return errors.badRequest(res, `Invalid page. Valid values: ${VALID_PAGES.join(', ')}`);
  }

  const userId = getUserId(req);

  try {
    // First, check if user_id column exists (for migration compatibility)
    const { data: columnCheck, error: columnError } = await supabase
      .from('ui_views')
      .select('*')
      .limit(1);

    const hasUserIdColumn = columnCheck && columnCheck.length > 0 ? 'user_id' in columnCheck[0] : false;
    const hasPageColumn = columnCheck && columnCheck.length > 0 ? 'page' in columnCheck[0] : false;
    const contextColumn = hasPageColumn ? 'page' : 'context';

    // Build query based on schema
    let query = supabase
      .from('ui_views')
      .select('*')
      .eq(contextColumn, page);

    // Filter by user_id and is_shared only if columns exist
    if (hasUserIdColumn) {
      if (userId) {
        query = query.or(`user_id.eq.${userId},is_shared.eq.true`);
      } else {
        query = query.eq('is_shared', true);
      }
    }

    const { data, error } = await query.order('sort_order', { ascending: true });

    if (error) {
      console.error('Views fetch error:', error);
      // Return empty views array instead of failing
      return sendSuccess(res, {
        views: [{
          id: null,
          name: 'All',
          filters: {},
          config: {},
          columns: [],
          sort: {},
          is_default: true,
          is_shared: false,
          is_owner: false,
          sort_order: -1,
        }],
        personal_views: [],
        shared_views: [],
        page,
        context: page,
      });
    }

    // Transform data: add is_owner flag and map legacy 'config' to 'filters'
    const views = (data || []).map(view => ({
      ...view,
      page: view.page || view.context,  // Handle both column names
      is_owner: hasUserIdColumn && userId ? view.user_id === userId : false,
      // Legacy support: expose filters as both 'filters' and 'config'
      config: view.filters || view.config || {},
      filters: view.filters || view.config || {}
    }));

    // Separate personal and shared views
    const personalViews = views.filter(v => v.is_owner);
    const sharedViews = views.filter(v => !v.is_owner && v.is_shared);

    // Prepend virtual "All" view
    const allView = {
      id: null,
      name: 'All',
      filters: {},
      config: {},
      columns: [],
      sort: {},
      is_default: true,
      is_shared: false,
      is_owner: false,
      sort_order: -1,
    };

    sendSuccess(res, {
      views: [allView, ...personalViews, ...sharedViews],
      personal_views: personalViews,
      shared_views: sharedViews,
      page,
      // Legacy support
      context: page,
    });
  } catch (err) {
    console.error('Views fetch error:', err);
    // Return empty views array with "All" view as fallback
    sendSuccess(res, {
      views: [{
        id: null,
        name: 'All',
        filters: {},
        config: {},
        columns: [],
        sort: {},
        is_default: true,
        is_shared: false,
        is_owner: false,
        sort_order: -1,
      }],
      personal_views: [],
      shared_views: [],
      page,
      context: page,
    });
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

    // Add is_owner flag
    const userId = getUserId(req);
    const result = {
      ...data,
      is_owner: userId ? data.user_id === userId : false,
      config: data.filters || {}
    };

    sendSuccess(res, result);
  } catch (err) {
    console.error('View fetch error:', err);
    errors.internal(res, 'Failed to fetch view');
  }
});

/**
 * POST /views
 * Create a new view
 * Body: { page, name, filters, columns?, sort?, is_default? }
 * Legacy support: { context, name, config }
 */
router.post('/', requireStaff, async (req, res) => {
  // Support both new 'page' and legacy 'context'
  const page = req.body.page || CONTEXT_TO_PAGE[req.body.context] || req.body.context;
  const name = req.body.name;
  // Support both 'filters' and legacy 'config'
  const filters = req.body.filters || req.body.config || {};
  const columns = req.body.columns || [];
  const sort = req.body.sort || {};
  const isDefault = req.body.is_default || false;

  if (!page) {
    return errors.badRequest(res, 'page is required');
  }

  if (!VALID_PAGES.includes(page)) {
    return errors.badRequest(res, `Invalid page. Valid values: ${VALID_PAGES.join(', ')}`);
  }

  if (!name || !name.trim()) {
    return errors.badRequest(res, 'name is required');
  }

  const userId = getUserId(req);

  try {
    // Calculate sort_order = max + 1 for this user's views on this page
    const { data: maxOrderData } = await supabase
      .from('ui_views')
      .select('sort_order')
      .eq('page', page)
      .eq('user_id', userId)
      .order('sort_order', { ascending: false })
      .limit(1);

    const nextSortOrder = (maxOrderData?.[0]?.sort_order ?? -1) + 1;

    // If setting as default, unset any existing default for this user on this page
    if (isDefault && userId) {
      await supabase
        .from('ui_views')
        .update({ is_default: false })
        .eq('page', page)
        .eq('user_id', userId)
        .eq('is_default', true);
    }

    const { data, error } = await supabase
      .from('ui_views')
      .insert({
        page,
        user_id: userId,
        name: name.trim(),
        filters: filters,
        columns: Array.isArray(columns) ? columns : [],
        sort: sort || {},
        is_default: isDefault,
        is_shared: false,
        sort_order: nextSortOrder,
        created_by: req.user?.email || req.user?.name || null,
      })
      .select()
      .single();

    if (error) {
      // Check for unique constraint violation
      if (error.code === '23505') {
        return errors.conflict(res, `A view named "${name}" already exists for ${page}`);
      }
      console.error('View create error:', error);
      return errors.internal(res, 'Failed to create view');
    }

    await auditLog({
      entityType: 'UI_VIEW',
      entityId: String(data.id),
      action: 'CREATE',
      afterJson: data,
      changesSummary: `Created view "${data.name}" for ${data.page}`,
      ...getAuditContext(req),
    });

    // Add computed fields
    const result = {
      ...data,
      is_owner: true,
      config: data.filters || {}
    };

    sendSuccess(res, result, 201);
  } catch (err) {
    console.error('View create error:', err);
    errors.internal(res, 'Failed to create view');
  }
});

/**
 * PUT /views/:id
 * Update a view (only own views)
 * Body: { name?, filters?, columns?, sort?, is_default? }
 */
router.put('/:id', requireStaff, async (req, res) => {
  const { id } = req.params;
  const { name, filters, config, columns, sort, is_default, sort_order } = req.body;

  const userId = getUserId(req);

  try {
    // Get current view for audit and ownership check
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

    // Check ownership - users can only update their own views
    if (current.user_id && current.user_id !== userId) {
      return errors.forbidden(res, 'You can only update your own views');
    }

    // If setting as default, unset any existing default for this user on this page
    if (is_default && !current.is_default && userId) {
      await supabase
        .from('ui_views')
        .update({ is_default: false })
        .eq('page', current.page)
        .eq('user_id', userId)
        .eq('is_default', true);
    }

    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    // Support both 'filters' and legacy 'config'
    if (filters !== undefined) updates.filters = filters;
    else if (config !== undefined) updates.filters = config;
    if (columns !== undefined) updates.columns = Array.isArray(columns) ? columns : [];
    if (sort !== undefined) updates.sort = sort;
    if (is_default !== undefined) updates.is_default = is_default;
    if (sort_order !== undefined) updates.sort_order = sort_order;

    const { data, error } = await supabase
      .from('ui_views')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return errors.conflict(res, `A view with this name already exists`);
      }
      console.error('View update error:', error);
      return errors.internal(res, 'Failed to update view');
    }

    await auditLog({
      entityType: 'UI_VIEW',
      entityId: String(id),
      action: 'UPDATE',
      beforeJson: current,
      afterJson: data,
      changesSummary: `Updated view "${data.name}"`,
      ...getAuditContext(req),
    });

    const result = {
      ...data,
      is_owner: true,
      config: data.filters || {}
    };

    sendSuccess(res, result);
  } catch (err) {
    console.error('View update error:', err);
    errors.internal(res, 'Failed to update view');
  }
});

/**
 * DELETE /views/:id
 * Delete a view (only own views)
 */
router.delete('/:id', requireStaff, async (req, res) => {
  const { id } = req.params;
  const userId = getUserId(req);

  try {
    // Get current view for audit and ownership check
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

    // Check ownership - users can only delete their own views
    if (current.user_id && current.user_id !== userId) {
      return errors.forbidden(res, 'You can only delete your own views');
    }

    const { error } = await supabase
      .from('ui_views')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('View delete error:', error);
      return errors.internal(res, 'Failed to delete view');
    }

    // Recompact sort_order sequence for this user's views on this page
    const { data: remaining } = await supabase
      .from('ui_views')
      .select('id')
      .eq('page', current.page)
      .eq('user_id', userId)
      .order('sort_order', { ascending: true });

    if (remaining && remaining.length > 0) {
      const updates = remaining.map((view, index) =>
        supabase
          .from('ui_views')
          .update({ sort_order: index })
          .eq('id', view.id)
      );
      await Promise.all(updates);
    }

    await auditLog({
      entityType: 'UI_VIEW',
      entityId: String(id),
      action: 'DELETE',
      beforeJson: current,
      changesSummary: `Deleted view "${current.name}" from ${current.page}`,
      ...getAuditContext(req),
    });

    sendSuccess(res, { deleted: true, id });
  } catch (err) {
    console.error('View delete error:', err);
    errors.internal(res, 'Failed to delete view');
  }
});

/**
 * POST /views/:id/share
 * Share a personal view (makes it visible to all users)
 */
router.post('/:id/share', requireStaff, async (req, res) => {
  const { id } = req.params;
  const userId = getUserId(req);

  try {
    // Get current view for audit and ownership check
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

    // Check ownership - users can only share their own views
    if (current.user_id && current.user_id !== userId) {
      return errors.forbidden(res, 'You can only share your own views');
    }

    // Already shared
    if (current.is_shared) {
      return sendSuccess(res, {
        ...current,
        is_owner: true,
        config: current.filters || {},
        message: 'View is already shared'
      });
    }

    const { data, error } = await supabase
      .from('ui_views')
      .update({ is_shared: true })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('View share error:', error);
      return errors.internal(res, 'Failed to share view');
    }

    await auditLog({
      entityType: 'UI_VIEW',
      entityId: String(id),
      action: 'SHARE',
      beforeJson: current,
      afterJson: data,
      changesSummary: `Shared view "${data.name}" with all users`,
      ...getAuditContext(req),
    });

    const result = {
      ...data,
      is_owner: true,
      config: data.filters || {}
    };

    sendSuccess(res, result);
  } catch (err) {
    console.error('View share error:', err);
    errors.internal(res, 'Failed to share view');
  }
});

/**
 * POST /views/:id/unshare
 * Unshare a shared view (makes it personal again)
 */
router.post('/:id/unshare', requireStaff, async (req, res) => {
  const { id } = req.params;
  const userId = getUserId(req);

  try {
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

    // Check ownership
    if (current.user_id && current.user_id !== userId) {
      return errors.forbidden(res, 'You can only unshare your own views');
    }

    if (!current.is_shared) {
      return sendSuccess(res, {
        ...current,
        is_owner: true,
        config: current.filters || {},
        message: 'View is not shared'
      });
    }

    const { data, error } = await supabase
      .from('ui_views')
      .update({ is_shared: false })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('View unshare error:', error);
      return errors.internal(res, 'Failed to unshare view');
    }

    await auditLog({
      entityType: 'UI_VIEW',
      entityId: String(id),
      action: 'UNSHARE',
      beforeJson: current,
      afterJson: data,
      changesSummary: `Unshared view "${data.name}"`,
      ...getAuditContext(req),
    });

    const result = {
      ...data,
      is_owner: true,
      config: data.filters || {}
    };

    sendSuccess(res, result);
  } catch (err) {
    console.error('View unshare error:', err);
    errors.internal(res, 'Failed to unshare view');
  }
});

/**
 * POST /views/reorder
 * Reorder views for a page
 * Body: { page, view_ids: [] }
 * Legacy support: { context, view_ids: [] }
 */
router.post('/reorder', requireStaff, async (req, res) => {
  const page = req.body.page || CONTEXT_TO_PAGE[req.body.context] || req.body.context;
  const { view_ids } = req.body;

  if (!page || !VALID_PAGES.includes(page)) {
    return errors.badRequest(res, `Invalid page. Valid values: ${VALID_PAGES.join(', ')}`);
  }

  if (!Array.isArray(view_ids) || view_ids.length === 0) {
    return errors.badRequest(res, 'view_ids array is required');
  }

  const userId = getUserId(req);

  try {
    // Update sort_order for each view (only user's own views)
    const updates = view_ids.map((viewId, index) =>
      supabase
        .from('ui_views')
        .update({ sort_order: index })
        .eq('id', viewId)
        .eq('page', page)
        .eq('user_id', userId)
    );

    await Promise.all(updates);

    // Fetch updated views
    let query = supabase
      .from('ui_views')
      .select('*')
      .eq('page', page);

    if (userId) {
      query = query.or(`user_id.eq.${userId},is_shared.eq.true`);
    } else {
      query = query.eq('is_shared', true);
    }

    const { data, error } = await query.order('sort_order', { ascending: true });

    if (error) {
      throw error;
    }

    const views = (data || []).map(view => ({
      ...view,
      is_owner: userId ? view.user_id === userId : false,
      config: view.filters || {}
    }));

    const allView = {
      id: null,
      name: 'All',
      filters: {},
      config: {},
      columns: [],
      sort: {},
      is_default: true,
      is_shared: false,
      is_owner: false,
      sort_order: -1,
    };

    sendSuccess(res, {
      views: [allView, ...views],
      page,
      context: page,
    });
  } catch (err) {
    console.error('Views reorder error:', err);
    errors.internal(res, 'Failed to reorder views');
  }
});

/**
 * POST /views/:id/set-default
 * Set a view as the default for the current user on its page
 */
router.post('/:id/set-default', requireStaff, async (req, res) => {
  const { id } = req.params;
  const userId = getUserId(req);

  try {
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

    // User can only set default on views they own or shared views
    const canSetDefault = current.user_id === userId || current.is_shared;
    if (!canSetDefault) {
      return errors.forbidden(res, 'Cannot set default on this view');
    }

    // Unset any existing default for this user on this page
    await supabase
      .from('ui_views')
      .update({ is_default: false })
      .eq('page', current.page)
      .eq('user_id', userId)
      .eq('is_default', true);

    // Set this view as default
    const { data, error } = await supabase
      .from('ui_views')
      .update({ is_default: true })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('View set-default error:', error);
      return errors.internal(res, 'Failed to set default view');
    }

    await auditLog({
      entityType: 'UI_VIEW',
      entityId: String(id),
      action: 'SET_DEFAULT',
      beforeJson: current,
      afterJson: data,
      changesSummary: `Set "${data.name}" as default view for ${data.page}`,
      ...getAuditContext(req),
    });

    const result = {
      ...data,
      is_owner: current.user_id === userId,
      config: data.filters || {}
    };

    sendSuccess(res, result);
  } catch (err) {
    console.error('View set-default error:', err);
    errors.internal(res, 'Failed to set default view');
  }
});

export default router;
