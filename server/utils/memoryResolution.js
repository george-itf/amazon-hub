import supabase from '../services/supabase.js';
import { normalizeAsin, normalizeSku, fingerprintTitle } from './identityNormalization.js';

/**
 * Attempts to resolve a listing against the memory table.  The lookup
 * order follows the binder specification: ASIN → SKU → title
 * fingerprint.  If a match is found the corresponding memory row is
 * returned (including its `bom_id`), otherwise null is returned.
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
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }
  // Then SKU
  const normalizedSku = normalizeSku(sku);
  if (normalizedSku) {
    const { data, error } = await supabase
      .from('listing_memory')
      .select('*')
      .eq('sku', normalizedSku)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }
  // Finally title fingerprint
  const fingerprint = fingerprintTitle(title);
  if (fingerprint) {
    const { data, error } = await supabase
      .from('listing_memory')
      .select('*')
      .eq('title_fingerprint', fingerprint)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }
  return null;
}