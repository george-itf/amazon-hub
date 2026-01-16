import express from 'express';
import supabase from '../services/supabase.js';
import { sendSuccess, errors } from '../middleware/correlationId.js';
import { resolveListing, resolveListingWithDetails } from '../utils/memoryResolution.js';
import { normalizeAsin, normalizeSku, fingerprintTitle } from '../utils/identityNormalization.js';
import { parseTitle, compareIntents, suggestComponents } from '../utils/deterministicParser.js';

const router = express.Router();

/**
 * POST /brain/resolve
 * Attempt to resolve a listing through the memory ladder
 */
router.post('/resolve', async (req, res) => {
  const { asin, sku, title } = req.body;

  if (!asin && !sku && !title) {
    return errors.badRequest(res, 'At least one of asin, sku, or title must be provided');
  }

  try {
    const result = await resolveListingWithDetails(asin, sku, title);

    // Also parse the title for intent
    const parseIntent = title ? parseTitle(title) : null;

    sendSuccess(res, {
      ...result,
      normalized: {
        asin: normalizeAsin(asin),
        sku: normalizeSku(sku),
        fingerprint: fingerprintTitle(title),
      },
      parse_intent: parseIntent,
    });
  } catch (err) {
    console.error('Brain resolve error:', err);
    errors.internal(res, 'Failed to resolve listing');
  }
});

/**
 * POST /brain/parse
 * Parse a title to extract structured information
 */
router.post('/parse', async (req, res) => {
  const { title } = req.body;

  if (!title) {
    return errors.badRequest(res, 'title is required');
  }

  try {
    const intent = parseTitle(title);
    const suggestions = suggestComponents(intent);

    sendSuccess(res, {
      title,
      normalized_fingerprint: fingerprintTitle(title),
      intent,
      suggestions,
    });
  } catch (err) {
    console.error('Brain parse error:', err);
    errors.internal(res, 'Failed to parse title');
  }
});

/**
 * POST /brain/compare
 * Compare two titles or intents for compatibility
 */
router.post('/compare', async (req, res) => {
  const { title1, title2, intent1, intent2 } = req.body;

  try {
    // Parse titles if intents not provided
    const parsedIntent1 = intent1 || (title1 ? parseTitle(title1) : null);
    const parsedIntent2 = intent2 || (title2 ? parseTitle(title2) : null);

    if (!parsedIntent1 || !parsedIntent2) {
      return errors.badRequest(res, 'Two titles or intents required for comparison');
    }

    const comparison = compareIntents(parsedIntent1, parsedIntent2);

    sendSuccess(res, {
      intent1: parsedIntent1,
      intent2: parsedIntent2,
      ...comparison,
    });
  } catch (err) {
    console.error('Brain compare error:', err);
    errors.internal(res, 'Failed to compare titles');
  }
});

/**
 * POST /brain/batch-resolve
 * Resolve multiple listings at once
 */
router.post('/batch-resolve', async (req, res) => {
  const { items } = req.body;

  if (!items || !Array.isArray(items)) {
    return errors.badRequest(res, 'items array is required');
  }

  if (items.length > 100) {
    return errors.badRequest(res, 'Maximum 100 items per batch');
  }

  try {
    const results = [];

    for (const item of items) {
      const { asin, sku, title, id } = item;

      const resolution = await resolveListingWithDetails(asin, sku, title);
      const intent = title ? parseTitle(title) : null;

      results.push({
        input_id: id || null,
        asin: normalizeAsin(asin),
        sku: normalizeSku(sku),
        ...resolution,
        parse_intent: intent,
      });
    }

    const resolved = results.filter(r => r.resolved).length;
    const unresolved = results.length - resolved;

    sendSuccess(res, {
      total: results.length,
      resolved,
      unresolved,
      items: results,
    });
  } catch (err) {
    console.error('Brain batch resolve error:', err);
    errors.internal(res, 'Failed to batch resolve listings');
  }
});

/**
 * GET /brain/suggest-bom
 * Suggest BOMs that might match a listing based on parse intent
 */
router.get('/suggest-bom', async (req, res) => {
  const { title, asin, sku } = req.query;

  if (!title) {
    return errors.badRequest(res, 'title is required');
  }

  try {
    const intent = parseTitle(title);
    const suggestions = [];

    // Query BOMs and their components
    const { data: boms, error } = await supabase
      .from('boms')
      .select(`
        id,
        bundle_sku,
        description,
        bom_components (
          qty_required,
          components (
            internal_sku,
            description
          )
        )
      `)
      .eq('is_active', true)
      .limit(50);

    if (error) {
      console.error('BOM fetch error:', error);
      return errors.internal(res, 'Failed to fetch BOMs');
    }

    // Score each BOM based on how well it matches the intent
    for (const bom of boms || []) {
      const score = scoreBomMatch(bom, intent, title);
      if (score.total > 0) {
        suggestions.push({
          bom_id: bom.id,
          bundle_sku: bom.bundle_sku,
          description: bom.description,
          score: score.total,
          score_breakdown: score.breakdown,
          components: bom.bom_components?.map(bc => ({
            qty: bc.qty_required,
            sku: bc.components?.internal_sku,
            description: bc.components?.description,
          })),
        });
      }
    }

    // Sort by score descending
    suggestions.sort((a, b) => b.score - a.score);

    sendSuccess(res, {
      title,
      intent,
      suggestions: suggestions.slice(0, 10),
      warning: suggestions.length === 0
        ? 'No matching BOMs found - manual creation may be needed'
        : 'Suggestions are advisory only - human review required',
    });
  } catch (err) {
    console.error('Brain suggest-bom error:', err);
    errors.internal(res, 'Failed to suggest BOMs');
  }
});

/**
 * GET /brain/health
 * Check brain system health
 */
router.get('/health', async (req, res) => {
  try {
    // Check listing memory count
    const { count: memoryCount } = await supabase
      .from('listing_memory')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    // Check BOM count
    const { count: bomCount } = await supabase
      .from('boms')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    // Check unresolved review queue
    const { count: unresolvedCount } = await supabase
      .from('review_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'PENDING');

    sendSuccess(res, {
      status: 'healthy',
      metrics: {
        active_listings: memoryCount || 0,
        active_boms: bomCount || 0,
        pending_reviews: unresolvedCount || 0,
      },
      capabilities: {
        memory_resolution: true,
        title_parsing: true,
        intent_comparison: true,
        bom_suggestion: true,
      },
    });
  } catch (err) {
    console.error('Brain health error:', err);
    errors.internal(res, 'Brain health check failed');
  }
});

/**
 * Helper: Score how well a BOM matches a parse intent
 */
function scoreBomMatch(bom, intent, title) {
  const breakdown = {};
  let total = 0;

  const desc = (bom.description || '').toLowerCase();
  const sku = (bom.bundle_sku || '').toLowerCase();
  const titleLower = (title || '').toLowerCase();

  // Check for brand match in SKU or description
  if (intent.brand) {
    const brandLower = intent.brand.toLowerCase();
    if (desc.includes(brandLower) || sku.includes(brandLower)) {
      breakdown.brand_match = 20;
      total += 20;
    }
  }

  // Check for tool type match
  if (intent.tool_core) {
    const toolWords = intent.tool_core.toLowerCase().replace(/_/g, ' ').split(' ');
    for (const word of toolWords) {
      if (desc.includes(word)) {
        breakdown.tool_match = 15;
        total += 15;
        break;
      }
    }
  }

  // Check for voltage match
  if (intent.voltage) {
    const voltageStr = `${intent.voltage}v`;
    if (desc.includes(voltageStr) || sku.includes(voltageStr)) {
      breakdown.voltage_match = 10;
      total += 10;
    }
  }

  // Check component count vs battery expectation
  if (intent.battery_qty !== null) {
    const batteryComponents = (bom.bom_components || []).filter(bc =>
      bc.components?.internal_sku?.toLowerCase().includes('batt') ||
      bc.components?.description?.toLowerCase().includes('battery')
    );

    const totalBatteries = batteryComponents.reduce((sum, bc) => sum + bc.qty_required, 0);
    if (totalBatteries === intent.battery_qty) {
      breakdown.battery_count_match = 25;
      total += 25;
    } else if (totalBatteries > 0 && intent.battery_qty > 0) {
      // Partial match
      breakdown.battery_partial_match = 10;
      total += 10;
    }
  }

  // Check for bare tool match
  if (intent.bare_tool === true) {
    // Bare tool should have no batteries/charger
    const hasBatteries = (bom.bom_components || []).some(bc =>
      bc.components?.description?.toLowerCase().includes('battery')
    );
    const hasCharger = (bom.bom_components || []).some(bc =>
      bc.components?.description?.toLowerCase().includes('charger')
    );

    if (!hasBatteries && !hasCharger) {
      breakdown.bare_tool_match = 20;
      total += 20;
    }
  }

  // Check for charger match
  if (intent.charger_included === true) {
    const hasCharger = (bom.bom_components || []).some(bc =>
      bc.components?.internal_sku?.toLowerCase().includes('charg') ||
      bc.components?.description?.toLowerCase().includes('charger')
    );
    if (hasCharger) {
      breakdown.charger_match = 15;
      total += 15;
    }
  }

  // Check for case match
  if (intent.case_included === true) {
    const hasCase = (bom.bom_components || []).some(bc =>
      bc.components?.internal_sku?.toLowerCase().includes('case') ||
      bc.components?.description?.toLowerCase().includes('case') ||
      bc.components?.description?.toLowerCase().includes('box')
    );
    if (hasCase) {
      breakdown.case_match = 10;
      total += 10;
    }
  }

  // Word overlap between title and BOM description
  const titleWords = new Set(titleLower.split(/\W+/).filter(w => w.length > 3));
  const descWords = new Set(desc.split(/\W+/).filter(w => w.length > 3));
  const overlap = [...titleWords].filter(w => descWords.has(w)).length;
  if (overlap > 2) {
    breakdown.word_overlap = Math.min(overlap * 2, 15);
    total += breakdown.word_overlap;
  }

  return { total, breakdown };
}

export default router;
