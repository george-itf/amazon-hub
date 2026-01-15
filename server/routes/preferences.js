import express from 'express';
import supabase from '../services/supabase.js';
import { sendSuccess, errors } from '../middleware/correlationId.js';

const router = express.Router();

/**
 * GET /preferences
 * Get all preferences for the current user
 */
router.get('/', async (req, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return errors.unauthorized(res, 'Authentication required');
  }

  try {
    const { data, error } = await supabase
      .from('user_preferences')
      .select('preference_key, preference_value, updated_at')
      .eq('user_id', userId);

    if (error) {
      console.error('Preferences fetch error:', error);
      return errors.internal(res, 'Failed to fetch preferences');
    }

    // Convert array to object for easier client-side use
    const preferences = {};
    for (const pref of data || []) {
      preferences[pref.preference_key] = pref.preference_value;
    }

    sendSuccess(res, { preferences });
  } catch (err) {
    console.error('Preferences fetch error:', err);
    errors.internal(res, 'Failed to fetch preferences');
  }
});

/**
 * GET /preferences/:key
 * Get a specific preference by key
 */
router.get('/:key', async (req, res) => {
  const userId = req.user?.id;
  const { key } = req.params;

  if (!userId) {
    return errors.unauthorized(res, 'Authentication required');
  }

  if (!key || key.length > 100) {
    return errors.badRequest(res, 'Invalid preference key');
  }

  try {
    const { data, error } = await supabase
      .from('user_preferences')
      .select('preference_value, updated_at')
      .eq('user_id', userId)
      .eq('preference_key', key)
      .maybeSingle();

    if (error) {
      console.error('Preference fetch error:', error);
      return errors.internal(res, 'Failed to fetch preference');
    }

    if (!data) {
      return sendSuccess(res, { value: null, exists: false });
    }

    sendSuccess(res, {
      value: data.preference_value,
      exists: true,
      updated_at: data.updated_at
    });
  } catch (err) {
    console.error('Preference fetch error:', err);
    errors.internal(res, 'Failed to fetch preference');
  }
});

/**
 * PUT /preferences/:key
 * Upsert a preference (create or update)
 * Body: { value: any }
 */
router.put('/:key', async (req, res) => {
  const userId = req.user?.id;
  const { key } = req.params;
  const { value } = req.body;

  if (!userId) {
    return errors.unauthorized(res, 'Authentication required');
  }

  if (!key || key.length > 100) {
    return errors.badRequest(res, 'Invalid preference key');
  }

  if (value === undefined) {
    return errors.badRequest(res, 'value is required');
  }

  try {
    const { data, error } = await supabase
      .from('user_preferences')
      .upsert(
        {
          user_id: userId,
          preference_key: key,
          preference_value: value,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'user_id,preference_key',
        }
      )
      .select('preference_key, preference_value, updated_at')
      .single();

    if (error) {
      console.error('Preference upsert error:', error);
      return errors.internal(res, 'Failed to save preference');
    }

    sendSuccess(res, {
      key: data.preference_key,
      value: data.preference_value,
      updated_at: data.updated_at
    });
  } catch (err) {
    console.error('Preference upsert error:', err);
    errors.internal(res, 'Failed to save preference');
  }
});

/**
 * DELETE /preferences/:key
 * Delete a preference
 */
router.delete('/:key', async (req, res) => {
  const userId = req.user?.id;
  const { key } = req.params;

  if (!userId) {
    return errors.unauthorized(res, 'Authentication required');
  }

  if (!key || key.length > 100) {
    return errors.badRequest(res, 'Invalid preference key');
  }

  try {
    const { error } = await supabase
      .from('user_preferences')
      .delete()
      .eq('user_id', userId)
      .eq('preference_key', key);

    if (error) {
      console.error('Preference delete error:', error);
      return errors.internal(res, 'Failed to delete preference');
    }

    sendSuccess(res, { deleted: true, key });
  } catch (err) {
    console.error('Preference delete error:', err);
    errors.internal(res, 'Failed to delete preference');
  }
});

export default router;
