import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  getSavedViews,
  createSavedView,
  updateSavedView,
  deleteSavedView,
  shareSavedView,
  unshareSavedView,
  setDefaultSavedView,
  reorderSavedViews,
} from '../utils/api.jsx';
import { logError } from '../utils/errorLogger.js';

/**
 * useSavedViews - Hook for managing saved views on any page
 *
 * Features:
 * - Loads views from API (personal + shared)
 * - Manages current active view state
 * - Syncs with URL params (viewId query param)
 * - Auto-applies default view on page load
 * - Provides CRUD operations for views
 *
 * @param {string} page - Page identifier: 'shipping', 'listings', 'inventory', 'components', 'orders', 'boms', 'returns', 'analytics', 'review'
 * @param {Object} options - Configuration options
 * @param {Function} options.onViewChange - Callback when active view changes: (view) => void
 * @param {boolean} options.syncUrl - Whether to sync view selection with URL (default: true)
 * @param {boolean} options.autoApplyDefault - Auto-apply default view on load (default: true)
 *
 * @returns {Object} Hook state and methods
 */
export function useSavedViews(page, options = {}) {
  const {
    onViewChange,
    syncUrl = true,
    autoApplyDefault = true,
  } = options;

  // URL params for view syncing
  const [searchParams, setSearchParams] = useSearchParams();

  // State
  const [views, setViews] = useState([]);
  const [personalViews, setPersonalViews] = useState([]);
  const [sharedViews, setSharedViews] = useState([]);
  const [activeViewId, setActiveViewId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  // Track if initial load has happened
  const initialLoadRef = useRef(false);
  const pageRef = useRef(page);

  // Get active view object
  const activeView = useMemo(() => {
    if (activeViewId === null) {
      // Return the "All" view (first item, which is virtual)
      return views[0] || { id: null, name: 'All', filters: {}, columns: [], sort: {} };
    }
    return views.find(v => v.id === activeViewId) || views[0];
  }, [views, activeViewId]);

  // Get default view for this page
  const defaultView = useMemo(() => {
    return views.find(v => v.is_default && v.id !== null) || null;
  }, [views]);

  /**
   * Load views from API
   */
  const loadViews = useCallback(async () => {
    if (!page) return;

    setLoading(true);
    setError(null);

    try {
      const data = await getSavedViews(page);

      // Update state with fetched views
      setViews(data.views || []);
      setPersonalViews(data.personal_views || []);
      setSharedViews(data.shared_views || []);

      // Handle initial view selection
      if (!initialLoadRef.current) {
        initialLoadRef.current = true;

        // Check URL for viewId
        const urlViewId = syncUrl ? searchParams.get('viewId') : null;

        if (urlViewId) {
          // URL has a view specified - use it
          const urlView = (data.views || []).find(v => String(v.id) === urlViewId);
          if (urlView) {
            setActiveViewId(urlView.id);
          }
        } else if (autoApplyDefault) {
          // No URL view - check for default
          const defaultV = (data.views || []).find(v => v.is_default && v.id !== null);
          if (defaultV) {
            setActiveViewId(defaultV.id);
            // Update URL if syncing
            if (syncUrl) {
              setSearchParams(prev => {
                const newParams = new URLSearchParams(prev);
                newParams.set('viewId', String(defaultV.id));
                return newParams;
              }, { replace: true });
            }
          }
        }
      }
    } catch (err) {
      logError('Failed to load views', err);
      setError(err.message || 'Failed to load views');
      // Fallback to just "All" view
      setViews([{ id: null, name: 'All', filters: {}, columns: [], sort: {}, is_default: true }]);
    } finally {
      setLoading(false);
    }
  }, [page, syncUrl, autoApplyDefault, searchParams, setSearchParams]);

  // Load views on mount and when page changes
  useEffect(() => {
    if (page !== pageRef.current) {
      // Page changed - reset state
      initialLoadRef.current = false;
      pageRef.current = page;
      setActiveViewId(null);
    }
    loadViews();
  }, [page, loadViews]);

  // Sync URL params to active view
  useEffect(() => {
    if (!syncUrl || !initialLoadRef.current) return;

    const urlViewId = searchParams.get('viewId');
    const currentIdStr = activeViewId ? String(activeViewId) : null;

    if (urlViewId !== currentIdStr) {
      if (urlViewId) {
        const view = views.find(v => String(v.id) === urlViewId);
        if (view) {
          setActiveViewId(view.id);
        }
      } else {
        setActiveViewId(null);
      }
    }
  }, [searchParams, syncUrl, views, activeViewId]);

  /**
   * Select a view as active
   */
  const selectView = useCallback((viewOrId) => {
    const viewId = typeof viewOrId === 'object' ? viewOrId?.id : viewOrId;
    const view = viewId === null
      ? views[0]
      : views.find(v => v.id === viewId);

    if (!view) return;

    setActiveViewId(view.id);

    // Update URL
    if (syncUrl) {
      setSearchParams(prev => {
        const newParams = new URLSearchParams(prev);
        if (view.id === null) {
          newParams.delete('viewId');
        } else {
          newParams.set('viewId', String(view.id));
        }
        return newParams;
      }, { replace: true });
    }

    // Notify parent
    if (onViewChange) {
      onViewChange(view);
    }
  }, [views, syncUrl, setSearchParams, onViewChange]);

  /**
   * Create a new view
   */
  const saveView = useCallback(async (name, config = {}) => {
    if (!page || !name?.trim()) {
      throw new Error('Page and name are required');
    }

    setSaving(true);
    try {
      const newView = await createSavedView(page, name.trim(), config);
      await loadViews();

      // Select the new view
      selectView(newView);

      return newView;
    } catch (err) {
      logError('Failed to save view', err);
      throw err;
    } finally {
      setSaving(false);
    }
  }, [page, loadViews, selectView]);

  /**
   * Update an existing view
   */
  const updateView = useCallback(async (viewId, updates) => {
    if (!viewId) {
      throw new Error('View ID is required');
    }

    setSaving(true);
    try {
      const updatedView = await updateSavedView(viewId, updates);
      await loadViews();
      return updatedView;
    } catch (err) {
      logError('Failed to update view', err);
      throw err;
    } finally {
      setSaving(false);
    }
  }, [loadViews]);

  /**
   * Delete a view
   */
  const deleteView = useCallback(async (viewId) => {
    if (!viewId) {
      throw new Error('View ID is required');
    }

    setSaving(true);
    try {
      await deleteSavedView(viewId);

      // If deleting active view, switch to "All"
      if (activeViewId === viewId) {
        selectView(null);
      }

      await loadViews();
    } catch (err) {
      logError('Failed to delete view', err);
      throw err;
    } finally {
      setSaving(false);
    }
  }, [activeViewId, loadViews, selectView]);

  /**
   * Share a view with all users
   */
  const shareView = useCallback(async (viewId) => {
    if (!viewId) {
      throw new Error('View ID is required');
    }

    setSaving(true);
    try {
      const updatedView = await shareSavedView(viewId);
      await loadViews();
      return updatedView;
    } catch (err) {
      logError('Failed to share view', err);
      throw err;
    } finally {
      setSaving(false);
    }
  }, [loadViews]);

  /**
   * Unshare a view (make it personal again)
   */
  const unshareView = useCallback(async (viewId) => {
    if (!viewId) {
      throw new Error('View ID is required');
    }

    setSaving(true);
    try {
      const updatedView = await unshareSavedView(viewId);
      await loadViews();
      return updatedView;
    } catch (err) {
      logError('Failed to unshare view', err);
      throw err;
    } finally {
      setSaving(false);
    }
  }, [loadViews]);

  /**
   * Set a view as default
   */
  const setDefault = useCallback(async (viewId) => {
    if (!viewId) {
      throw new Error('View ID is required');
    }

    setSaving(true);
    try {
      const updatedView = await setDefaultSavedView(viewId);
      await loadViews();
      return updatedView;
    } catch (err) {
      logError('Failed to set default view', err);
      throw err;
    } finally {
      setSaving(false);
    }
  }, [loadViews]);

  /**
   * Reorder views
   */
  const reorderViews = useCallback(async (viewIds) => {
    if (!page || !Array.isArray(viewIds)) {
      throw new Error('Page and view IDs array are required');
    }

    setSaving(true);
    try {
      await reorderSavedViews(page, viewIds);
      await loadViews();
    } catch (err) {
      logError('Failed to reorder views', err);
      throw err;
    } finally {
      setSaving(false);
    }
  }, [page, loadViews]);

  /**
   * Get the current filter/column/sort config from active view
   */
  const getActiveConfig = useCallback(() => {
    return {
      filters: activeView?.filters || {},
      columns: activeView?.columns || [],
      sort: activeView?.sort || {},
    };
  }, [activeView]);

  /**
   * Check if current view is modified from saved state
   * @param {Object} currentConfig - Current filter/column/sort state
   */
  const isModified = useCallback((currentConfig) => {
    if (!activeView || activeView.id === null) return false;

    const savedFilters = activeView.filters || {};
    const savedColumns = activeView.columns || [];
    const savedSort = activeView.sort || {};

    const currentFilters = currentConfig.filters || {};
    const currentColumns = currentConfig.columns || [];
    const currentSort = currentConfig.sort || {};

    // Compare filters
    const filtersMatch = JSON.stringify(savedFilters) === JSON.stringify(currentFilters);
    // Compare columns
    const columnsMatch = JSON.stringify(savedColumns) === JSON.stringify(currentColumns);
    // Compare sort
    const sortMatch = JSON.stringify(savedSort) === JSON.stringify(currentSort);

    return !filtersMatch || !columnsMatch || !sortMatch;
  }, [activeView]);

  /**
   * Clear active view and reset to "All"
   */
  const clearView = useCallback(() => {
    selectView(null);
  }, [selectView]);

  return {
    // State
    views,
    personalViews,
    sharedViews,
    activeView,
    activeViewId,
    defaultView,
    loading,
    error,
    saving,

    // Methods
    loadViews,
    selectView,
    saveView,
    updateView,
    deleteView,
    shareView,
    unshareView,
    setDefault,
    reorderViews,
    getActiveConfig,
    isModified,
    clearView,

    // Computed
    hasViews: views.length > 1, // More than just "All"
    hasPersonalViews: personalViews.length > 0,
    hasSharedViews: sharedViews.length > 0,
    isViewSelected: activeViewId !== null,
  };
}

export default useSavedViews;
