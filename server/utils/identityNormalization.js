/**
 * Normalises an ASIN by stripping whitespace and converting to
 * uppercase.  Returns null if the input is falsy.
 *
 * @param {string} asin
 * @returns {string|null}
 */
export function normalizeAsin(asin) {
  if (!asin) return null;
  return asin.trim().toUpperCase();
}

/**
 * Normalises an SKU by stripping whitespace and converting to
 * uppercase.  Returns null if the input is falsy.
 *
 * @param {string} sku
 * @returns {string|null}
 */
export function normalizeSku(sku) {
  if (!sku) return null;
  return sku.trim().toUpperCase();
}

/**
 * Computes a simple fingerprint for a listing title.  The
 * fingerprint lowercases the string, removes non‑alphanumeric
 * characters and collapses whitespace.  This is a deterministic
 * transformation used for memory lookup.  Returns null if the title
 * is falsy.
 *
 * @param {string} title
 * @returns {string|null}
 */
export function fingerprintTitle(title) {
  if (!title) return null;
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}