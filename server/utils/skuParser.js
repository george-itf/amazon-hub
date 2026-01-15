/**
 * SKU Parser Utility
 *
 * Parses compound seller SKUs like "MAKDHR242Z+2xBL1850+DC18RC"
 * into component parts with quantities for deterministic BOM inference.
 *
 * Splitting rules:
 * - Split by + or / delimiters
 * - Handle quantity prefixes: "2x", "2X", "x2", "X2"
 * - Strip common wrapper prefixes: "MAK", "DEW" (manufacturer codes)
 *
 * Returns array of { sku: string, qty: number } objects
 */

/**
 * Common manufacturer prefix patterns that may wrap component SKUs
 */
const MANUFACTURER_PREFIXES = ['MAK', 'DEW', 'MIL', 'BOS', 'HIT', 'FES'];

/**
 * Parse a compound SKU into component parts
 *
 * @param {string} sku - The seller SKU to parse
 * @returns {Array<{sku: string, qty: number}>} Array of parsed components
 *
 * @example
 * parseCompoundSku('MAKDHR242Z+2xBL1850+DC18RC')
 * // Returns: [
 * //   { sku: 'DHR242Z', qty: 1 },
 * //   { sku: 'BL1850', qty: 2 },
 * //   { sku: 'DC18RC', qty: 1 }
 * // ]
 */
export function parseCompoundSku(sku) {
  if (!sku || typeof sku !== 'string') {
    return [];
  }

  // Normalize: uppercase, trim whitespace
  const normalizedSku = sku.trim().toUpperCase();

  // Split by + or / delimiters
  const parts = normalizedSku.split(/[+\/]/);

  const components = [];

  for (let part of parts) {
    part = part.trim();
    if (!part) continue;

    // Extract quantity prefix: "2x", "2X", "x2", "X2", "3x", etc.
    let qty = 1;
    let skuPart = part;

    // Match patterns like "2x", "2X" at start
    const prefixMatch = part.match(/^(\d+)\s*[xX]\s*(.+)$/);
    if (prefixMatch) {
      qty = parseInt(prefixMatch[1], 10);
      skuPart = prefixMatch[2];
    } else {
      // Match patterns like "x2", "X2" at end
      const suffixMatch = part.match(/^(.+?)\s*[xX]\s*(\d+)$/);
      if (suffixMatch) {
        skuPart = suffixMatch[1];
        qty = parseInt(suffixMatch[2], 10);
      }
    }

    // Strip manufacturer prefix if present
    skuPart = stripManufacturerPrefix(skuPart);

    if (skuPart) {
      components.push({
        sku: skuPart,
        qty: qty || 1
      });
    }
  }

  return components;
}

/**
 * Strip common manufacturer prefixes from a SKU part
 *
 * @param {string} skuPart
 * @returns {string}
 */
function stripManufacturerPrefix(skuPart) {
  if (!skuPart) return '';

  for (const prefix of MANUFACTURER_PREFIXES) {
    if (skuPart.startsWith(prefix) && skuPart.length > prefix.length) {
      // Only strip if what remains looks like a valid SKU (has letters/numbers)
      const remainder = skuPart.slice(prefix.length);
      if (/^[A-Z0-9]/.test(remainder)) {
        return remainder;
      }
    }
  }

  return skuPart;
}

/**
 * Check if a SKU looks like a compound/bundle SKU
 *
 * @param {string} sku
 * @returns {boolean}
 */
export function isCompoundSku(sku) {
  if (!sku || typeof sku !== 'string') return false;

  // Contains + or / delimiter
  if (/[+\/]/.test(sku)) return true;

  // Contains quantity indicator like "2x" or "x2"
  if (/\d+[xX]|[xX]\d+/.test(sku)) return true;

  return false;
}

/**
 * Attempt to match parsed SKU parts against a list of component SKUs
 *
 * Uses flexible matching:
 * 1. Exact match
 * 2. Match ignoring common suffixes (Z for body-only tools)
 * 3. Match as substring of component SKU
 *
 * @param {Array<{sku: string, qty: number}>} parsedParts
 * @param {Array<{id: string, internal_sku: string}>} components
 * @returns {Array<{component_id: string, internal_sku: string, qty_required: number, match_type: string}|null>}
 */
export function matchParsedSkuToComponents(parsedParts, components) {
  if (!parsedParts || parsedParts.length === 0) return [];
  if (!components || components.length === 0) return [];

  const matches = [];

  for (const part of parsedParts) {
    const { sku: parsedSku, qty } = part;
    let matchedComponent = null;
    let matchType = null;

    // Build lookup variations
    const skuVariations = [
      parsedSku,
      parsedSku.replace(/Z$/, ''), // Strip trailing Z (body-only indicator)
      parsedSku + 'Z', // Add trailing Z
    ];

    // 1. Try exact match
    for (const variation of skuVariations) {
      matchedComponent = components.find(c =>
        c.internal_sku?.toUpperCase() === variation
      );
      if (matchedComponent) {
        matchType = variation === parsedSku ? 'EXACT' : 'VARIATION';
        break;
      }
    }

    // 2. Try contains match (parsed SKU is contained in component SKU)
    if (!matchedComponent) {
      matchedComponent = components.find(c => {
        const compSku = c.internal_sku?.toUpperCase() || '';
        return compSku.includes(parsedSku) || parsedSku.includes(compSku);
      });
      if (matchedComponent) matchType = 'CONTAINS';
    }

    // 3. Try partial match (first N characters match)
    if (!matchedComponent && parsedSku.length >= 5) {
      const prefix = parsedSku.slice(0, 5);
      matchedComponent = components.find(c =>
        c.internal_sku?.toUpperCase().startsWith(prefix)
      );
      if (matchedComponent) matchType = 'PREFIX';
    }

    if (matchedComponent) {
      matches.push({
        component_id: matchedComponent.id,
        internal_sku: matchedComponent.internal_sku,
        qty_required: qty,
        match_type: matchType,
        parsed_sku: parsedSku
      });
    } else {
      // Return null for unmatched parts to indicate partial failure
      matches.push(null);
    }
  }

  return matches;
}

/**
 * Parse a compound SKU and match against components in one step
 *
 * @param {string} sku
 * @param {Array<{id: string, internal_sku: string}>} components
 * @returns {{
 *   parsed: Array<{sku: string, qty: number}>,
 *   matches: Array<{component_id: string, internal_sku: string, qty_required: number}|null>,
 *   allMatched: boolean,
 *   matchedCount: number,
 *   totalParts: number
 * }}
 */
export function parseAndMatchSku(sku, components) {
  const parsed = parseCompoundSku(sku);
  const matches = matchParsedSkuToComponents(parsed, components);

  const matchedCount = matches.filter(m => m !== null).length;

  return {
    parsed,
    matches,
    allMatched: matchedCount === parsed.length && parsed.length > 0,
    matchedCount,
    totalParts: parsed.length
  };
}

/**
 * Generate a suggested bundle_sku from matched components
 *
 * @param {Array<{internal_sku: string, qty_required: number}>} matchedComponents
 * @returns {string}
 */
export function generateBundleSku(matchedComponents) {
  if (!matchedComponents || matchedComponents.length === 0) return '';

  return matchedComponents
    .map(m => {
      const sku = m.internal_sku || '';
      return m.qty_required > 1 ? `${m.qty_required}x${sku}` : sku;
    })
    .join('+');
}
