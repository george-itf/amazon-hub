import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import {
  getUserPreferences,
  setUserPreference as apiSetPreference,
  deleteUserPreference as apiDeletePreference,
} from '../utils/api.jsx';

/**
 * Hook for managing user preferences with cross-device sync.
 *
 * When logged in, preferences are stored in the database and synced across devices.
 * When logged out, falls back to localStorage for local-only storage.
 *
 * @returns {Object} Preferences state and actions
 * @property {Object} preferences - All loaded preferences keyed by preference_key
 * @property {boolean} loading - Whether initial load is in progress
 * @property {Error|null} error - Any error that occurred during operations
 * @property {Function} getPreference - Get a specific preference value
 * @property {Function} setPreference - Set a preference (syncs to server if logged in)
 * @property {Function} deletePreference - Delete a preference
 * @property {Function} refresh - Reload preferences from server
 */
export function useUserPreferences() {
  const { user } = useAuth();
  const [preferences, setPreferences] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const isLoggedIn = !!user;

  // Track if component is mounted to prevent state updates after unmount
  const mountedRef = useRef(true);

  // Load preferences on mount and when login state changes
  useEffect(() => {
    mountedRef.current = true;
    loadPreferences();

    return () => {
      mountedRef.current = false;
    };
  }, [isLoggedIn]);

  /**
   * Load all preferences from server (if logged in) or localStorage
   */
  const loadPreferences = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      if (isLoggedIn) {
        // Fetch from server
        const data = await getUserPreferences();
        if (mountedRef.current) {
          setPreferences(data.preferences || {});
        }
      } else {
        // Fall back to localStorage
        const localPrefs = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          // Only include our preference keys (avoid other localStorage items)
          if (key && (
            key === 'inventory_custom_tabs' ||
            key === 'listings_custom_tabs' ||
            key === 'amazon_hub_defaults'
          )) {
            try {
              localPrefs[key] = JSON.parse(localStorage.getItem(key));
            } catch {
              // Skip invalid JSON
            }
          }
        }
        if (mountedRef.current) {
          setPreferences(localPrefs);
        }
      }
    } catch (err) {
      console.error('Failed to load preferences:', err);
      if (mountedRef.current) {
        setError(err);
        // On error, try to load from localStorage as fallback
        const localPrefs = {};
        for (const key of ['inventory_custom_tabs', 'listings_custom_tabs', 'amazon_hub_defaults']) {
          try {
            const val = localStorage.getItem(key);
            if (val) {
              localPrefs[key] = JSON.parse(val);
            }
          } catch {
            // Skip invalid JSON
          }
        }
        setPreferences(localPrefs);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [isLoggedIn]);

  /**
   * Get a specific preference value
   * @param {string} key - Preference key
   * @param {any} defaultValue - Default value if preference doesn't exist
   * @returns {any} The preference value or default
   */
  const getPreference = useCallback((key, defaultValue = null) => {
    if (preferences.hasOwnProperty(key)) {
      return preferences[key];
    }
    return defaultValue;
  }, [preferences]);

  /**
   * Set a preference value
   * @param {string} key - Preference key
   * @param {any} value - Value to store
   * @returns {Promise<void>}
   */
  const setPreference = useCallback(async (key, value) => {
    // Optimistically update local state
    setPreferences(prev => ({ ...prev, [key]: value }));

    // Always save to localStorage as backup/offline fallback
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.warn('Failed to save to localStorage:', err);
    }

    // If logged in, sync to server
    if (isLoggedIn) {
      try {
        await apiSetPreference(key, value);
      } catch (err) {
        console.error('Failed to sync preference to server:', err);
        // Don't revert local state - localStorage serves as fallback
        // The preference will sync on next login or refresh
        setError(err);
      }
    }
  }, [isLoggedIn]);

  /**
   * Delete a preference
   * @param {string} key - Preference key to delete
   * @returns {Promise<void>}
   */
  const deletePreference = useCallback(async (key) => {
    // Optimistically update local state
    setPreferences(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });

    // Always remove from localStorage
    try {
      localStorage.removeItem(key);
    } catch (err) {
      console.warn('Failed to remove from localStorage:', err);
    }

    // If logged in, delete from server
    if (isLoggedIn) {
      try {
        await apiDeletePreference(key);
      } catch (err) {
        console.error('Failed to delete preference from server:', err);
        setError(err);
      }
    }
  }, [isLoggedIn]);

  /**
   * Refresh preferences from server
   * @returns {Promise<void>}
   */
  const refresh = useCallback(() => {
    return loadPreferences();
  }, [loadPreferences]);

  return {
    preferences,
    loading,
    error,
    getPreference,
    setPreference,
    deletePreference,
    refresh,
    isLoggedIn,
  };
}

/**
 * Hook for a single preference value with automatic loading and syncing.
 * Convenience wrapper around useUserPreferences for single-preference use cases.
 *
 * @param {string} key - The preference key
 * @param {any} defaultValue - Default value if preference doesn't exist
 * @returns {[any, Function, boolean]} [value, setValue, loading]
 */
export function usePreference(key, defaultValue = null) {
  const { getPreference, setPreference, loading } = useUserPreferences();

  const value = getPreference(key, defaultValue);

  const setValue = useCallback((newValue) => {
    return setPreference(key, newValue);
  }, [key, setPreference]);

  return [value, setValue, loading];
}

export default useUserPreferences;
