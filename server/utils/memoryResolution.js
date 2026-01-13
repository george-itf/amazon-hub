import crypto from 'crypto';
import supabase from '../services/supabase.js';
import { normalizeAsin, normalizeSku, fingerprintTitle } from './identityNormalization.js';

/**
 * Attempts to resolve a listing against the memory table.  The lookup
 * order follows the binder specification: ASIN → SKU → title fingerprint hash.
 * Only active entries are matched.
 * If a match is found the corresponding memory row is returned (including
 * its `bom_id`), otherwise null is returned.
 *
 * @param {string|null} asin
 * @param {string|null} sku
 * @param {string|null} title
 * @returns {Promise<Object|null>} listing_memory row or null
 */
export async function resolveListing(asin, sku, title) {
  // Try ASIN first
  const normalizedAsin = normalizeAsin(asin);
  if (normalizedAsin) {
    const { data, error } = await supabase
      .from('listing_memory')
      .select('*')
      .eq('asin', normalizedAsin)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw error;
    if (data) return { ...data, resolution_method: 'ASIN' };
  }

  // Then SKU
  const normalizedSku = normalizeSku(sku);
  if (normalizedSku) {
    const { data, error } = await supabase
      .from('listing_memory')
      .select('*')
      .eq('sku', normalizedSku)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw error;
    if (data) return { ...data, resolution_method: 'SKU' };
  }

  // Finally title fingerprint hash
  const fingerprint = fingerprintTitle(title);
  if (fingerprint) {
    const fingerprintHash = crypto.createHash('sha256').update(fingerprint).digest('hex');
    const { data, error } = await supabase
      .from('listing_memory')
      .select('*')
      .eq('title_fingerprint_hash', fingerprintHash)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw error;
    if (data) return { ...data, resolution_method: 'FINGERPRINT' };
  }

  return null;
}

/**
 * Attempts resolution and returns detailed result including confidence
 * @param {string|null} asin
 * @param {string|null} sku
 * @param {string|null} title
 * @returns {Promise<Object>} Resolution result with status
 */
export async function resolveListingWithDetails(asin, sku, title) {
  const result = await resolveListing(asin, sku, title);

  if (!result) {
    return {
      resolved: false,
      reason: 'NO_MATCH',
      suggestion: null
    };
  }

  if (!result.bom_id) {
    return {
      resolved: false,
      reason: 'BOM_NOT_SET',
      listing_memory: result,
      suggestion: 'Listing exists but needs BOM assignment'
    };
  }

  return {
    resolved: true,
    listing_memory: result,
    bom_id: result.bom_id,
    resolution_method: result.resolution_method
  };
}