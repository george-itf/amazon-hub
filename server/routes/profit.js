import express from 'express';
import supabase from '../services/supabase.js';
import { sendSuccess, errors } from '../middleware/correlationId.js';
import { requireStaff } from '../middleware/auth.js';
import {
  calculateProfit,
  calculateTargetPrice,
  calculateBreakEvenPrice,
  DEFAULT_FEE_CONFIG
} from '../services/feeCalculator.js';

const router = express.Router();

/**
 * POST /profit/analyze
 * Analyze profitability for an ASIN with given components
 *
 * Body:
 * - asin: string (required) - Amazon ASIN to analyze
 * - components: array of { component_id, qty_required } - Components that make up this product
 * - sizeTier: string (optional) - 'small', 'standard', 'large', 'oversize'
 * - targetMarginPercent: number (optional, default 10) - Target margin to calculate price for
 *
 * Returns:
 * - Product info from Keepa (title, current price, sales rank, etc.)
 * - Cost breakdown from components
 * - Profit at current price
 * - Price needed for target margin
 * - Sales velocity indicators
 */
router.post('/analyze', requireStaff, async (req, res) => {
  const {
    asin,
    components = [],
    sizeTier = 'standard',
    targetMarginPercent = 10
  } = req.body;

  if (!asin) {
    return errors.badRequest(res, 'ASIN is required');
  }

  if (!components || !Array.isArray(components) || components.length === 0) {
    return errors.badRequest(res, 'At least one component is required');
  }

  // Validate components
  for (const comp of components) {
    if (!comp.component_id) {
      return errors.badRequest(res, 'Each component must have a component_id');
    }
    if (!comp.qty_required || comp.qty_required <= 0) {
      return errors.badRequest(res, 'Each component must have a positive qty_required');
    }
  }

  try {
    // 1. Fetch Keepa data for the ASIN
    let keepaData = null;
    let productInfo = null;

    const { data: cached } = await supabase
      .from('keepa_products_cache')
      .select('*')
      .eq('asin', asin.toUpperCase())
      .maybeSingle();

    if (cached?.payload_json) {
      keepaData = cached.payload_json;
    } else {
      // Try to fetch from Keepa API
      // Check settings first
      const { data: settings } = await supabase
        .from('keepa_settings')
        .select('*')
        .single();

      if (settings) {
        // Call Keepa API
        const apiKey = process.env.KEEPA_API_KEY;
        if (apiKey) {
          try {
            const keepaUrl = `https://api.keepa.com/product?key=${apiKey}&domain=${settings.domain_id || 2}&asin=${asin.toUpperCase()}`;
            const response = await fetch(keepaUrl);
            const data = await response.json();

            if (data.products && data.products[0]) {
              keepaData = data.products[0];

              // Cache it
              await supabase.from('keepa_products_cache').upsert({
                asin: asin.toUpperCase(),
                payload_json: keepaData,
                expires_at: new Date(Date.now() + 720 * 60 * 1000).toISOString(),
              });
            }
          } catch (fetchErr) {
            console.error('Keepa fetch error:', fetchErr);
            // Continue without Keepa data
          }
        }
      }
    }

    // Extract product info from Keepa data
    if (keepaData) {
      // Keepa price format: array where each element is [time, price]
      // Or CSV format where index maps to data type
      // CSV indices: 0=Amazon, 1=New, 2=Used, 3=Sales Rank, etc.
      const csv = keepaData.csv || [];

      // Get latest Buy Box price (index 18) or Amazon price (index 0)
      let currentPricePence = null;
      const buyBoxPrices = csv[18] || csv[0]; // Buy Box or Amazon
      if (buyBoxPrices && Array.isArray(buyBoxPrices) && buyBoxPrices.length >= 2) {
        // Get the last price (most recent)
        const lastPrice = buyBoxPrices[buyBoxPrices.length - 1];
        if (lastPrice > 0) {
          currentPricePence = lastPrice; // Keepa prices are in cents, same as pence for UK
        }
      }

      // Get sales rank
      let salesRank = null;
      const salesRankData = csv[3];
      if (salesRankData && Array.isArray(salesRankData) && salesRankData.length >= 2) {
        salesRank = salesRankData[salesRankData.length - 1];
      }

      // Get offer count (index 11)
      let offerCount = null;
      const offerData = csv[11];
      if (offerData && Array.isArray(offerData) && offerData.length >= 2) {
        offerCount = offerData[offerData.length - 1];
      }

      // Get rating (index 16) - stored as rating * 10
      let rating = null;
      const ratingData = csv[16];
      if (ratingData && Array.isArray(ratingData) && ratingData.length >= 2) {
        const rawRating = ratingData[ratingData.length - 1];
        if (rawRating > 0) {
          rating = rawRating / 10;
        }
      }

      // Get review count (index 17)
      let reviewCount = null;
      const reviewData = csv[17];
      if (reviewData && Array.isArray(reviewData) && reviewData.length >= 2) {
        reviewCount = reviewData[reviewData.length - 1];
      }

      productInfo = {
        asin: asin.toUpperCase(),
        title: keepaData.title || 'Unknown Product',
        currentPricePence,
        salesRank,
        offerCount,
        rating,
        reviewCount,
        category: keepaData.categoryTree?.[0]?.name || 'Unknown',
        imageUrl: keepaData.imagesCSV ? `https://images-na.ssl-images-amazon.com/images/I/${keepaData.imagesCSV.split(',')[0]}` : null,
        lastUpdated: cached?.expires_at ? new Date(cached.expires_at).toISOString() : null,
      };
    } else {
      productInfo = {
        asin: asin.toUpperCase(),
        title: 'Unknown - Keepa data not available',
        currentPricePence: null,
        salesRank: null,
        offerCount: null,
        rating: null,
        reviewCount: null,
        category: 'Unknown',
        imageUrl: null,
        lastUpdated: null,
      };
    }

    // 2. Fetch component costs
    const componentIds = components.map(c => c.component_id);
    const { data: componentData, error: compError } = await supabase
      .from('components')
      .select('id, internal_sku, description, cost_ex_vat_pence')
      .in('id', componentIds);

    if (compError) {
      console.error('Component fetch error:', compError);
      return errors.internal(res, 'Failed to fetch component data');
    }

    // Build component cost breakdown
    let totalCostPence = 0;
    const componentBreakdown = [];

    for (const comp of components) {
      const compInfo = componentData?.find(c => c.id === comp.component_id);
      const unitCost = compInfo?.cost_ex_vat_pence || 0;
      const lineCost = unitCost * comp.qty_required;
      totalCostPence += lineCost;

      componentBreakdown.push({
        component_id: comp.component_id,
        internal_sku: compInfo?.internal_sku || 'Unknown',
        description: compInfo?.description || '',
        qty_required: comp.qty_required,
        unit_cost_pence: unitCost,
        line_cost_pence: lineCost,
      });
    }

    // 3. Calculate profit at current price
    let profitAtCurrentPrice = null;
    if (productInfo.currentPricePence) {
      profitAtCurrentPrice = calculateProfit({
        sellingPricePence: productInfo.currentPricePence,
        costPence: totalCostPence,
        sizeTier,
      });
    }

    // 4. Calculate price needed for target margin
    const targetPriceAnalysis = calculateTargetPrice({
      costPence: totalCostPence,
      targetMarginPercent,
      sizeTier,
    });

    // 5. Calculate break-even price
    const breakEvenPrice = calculateBreakEvenPrice(totalCostPence, sizeTier);

    // 6. Calculate sales velocity indicators
    let salesVelocity = {
      indicator: 'unknown',
      description: 'Unable to determine - no sales rank data',
    };

    if (productInfo.salesRank) {
      const rank = productInfo.salesRank;
      if (rank < 1000) {
        salesVelocity = {
          indicator: 'excellent',
          description: 'Top 1,000 - Very high sales volume, likely multiple daily sales',
          estimatedMonthlySales: '500+',
        };
      } else if (rank < 10000) {
        salesVelocity = {
          indicator: 'good',
          description: 'Top 10,000 - Good sales volume, likely daily sales',
          estimatedMonthlySales: '100-500',
        };
      } else if (rank < 50000) {
        salesVelocity = {
          indicator: 'moderate',
          description: 'Top 50,000 - Moderate sales, multiple weekly sales',
          estimatedMonthlySales: '30-100',
        };
      } else if (rank < 100000) {
        salesVelocity = {
          indicator: 'low',
          description: 'Top 100,000 - Lower sales, weekly sales likely',
          estimatedMonthlySales: '10-30',
        };
      } else {
        salesVelocity = {
          indicator: 'very_low',
          description: 'Below 100,000 - Slow sales, may take weeks between sales',
          estimatedMonthlySales: '<10',
        };
      }
    }

    // 7. Build recommendation
    let recommendation = {
      action: 'review',
      summary: '',
    };

    if (profitAtCurrentPrice) {
      if (profitAtCurrentPrice.netMarginPercent >= 15) {
        recommendation = {
          action: 'highly_profitable',
          summary: `Excellent opportunity! ${profitAtCurrentPrice.netMarginPercent}% net margin at current price.`,
        };
      } else if (profitAtCurrentPrice.netMarginPercent >= 10) {
        recommendation = {
          action: 'profitable',
          summary: `Good opportunity with ${profitAtCurrentPrice.netMarginPercent}% net margin.`,
        };
      } else if (profitAtCurrentPrice.netMarginPercent >= 0) {
        recommendation = {
          action: 'marginal',
          summary: `Low margin at ${profitAtCurrentPrice.netMarginPercent}%. Consider if volume justifies.`,
        };
      } else {
        recommendation = {
          action: 'unprofitable',
          summary: `Currently unprofitable at ${profitAtCurrentPrice.netMarginPercent}% margin. Would need £${(targetPriceAnalysis.targetPricePence / 100).toFixed(2)} for ${targetMarginPercent}% margin.`,
        };
      }

      // Add sales velocity consideration
      if (salesVelocity.indicator === 'excellent' || salesVelocity.indicator === 'good') {
        recommendation.summary += ` Sales velocity is ${salesVelocity.indicator}.`;
      } else if (salesVelocity.indicator === 'very_low') {
        recommendation.summary += ' Warning: Low sales velocity - stock may sit for weeks.';
      }
    } else {
      recommendation = {
        action: 'no_price_data',
        summary: 'Cannot evaluate - no current price available from Keepa.',
      };
    }

    // Return comprehensive analysis
    sendSuccess(res, {
      product: productInfo,
      costs: {
        totalCostPence,
        componentBreakdown,
      },
      profitAtCurrentPrice,
      targetPriceAnalysis: {
        targetMarginPercent,
        targetPricePence: targetPriceAnalysis.targetPricePence,
        targetPricePounds: targetPriceAnalysis.targetPricePence
          ? (targetPriceAnalysis.targetPricePence / 100).toFixed(2)
          : null,
        achievable: targetPriceAnalysis.achievable,
        verification: targetPriceAnalysis.verification,
      },
      breakEvenPricePence: breakEvenPrice,
      breakEvenPricePounds: (breakEvenPrice / 100).toFixed(2),
      salesVelocity,
      feeConfig: {
        referralFeePercent: DEFAULT_FEE_CONFIG.referralFeePercent,
        sizeTier,
        fbaFeePence: DEFAULT_FEE_CONFIG.fbaFees[sizeTier],
      },
      recommendation,
    });
  } catch (err) {
    console.error('Profit analysis error:', err);
    errors.internal(res, 'Failed to analyze profitability');
  }
});

/**
 * GET /profit/quick/:asin
 * Quick profit check for an ASIN using existing BOM if linked
 */
router.get('/quick/:asin', requireStaff, async (req, res) => {
  const { asin } = req.params;

  try {
    // Find listing memory entry for this ASIN
    const { data: listing, error: listingError } = await supabase
      .from('listing_memory')
      .select(`
        *,
        boms (
          id,
          bundle_sku,
          description,
          bom_components (
            component_id,
            qty_required,
            components (
              id,
              internal_sku,
              description,
              cost_ex_vat_pence
            )
          )
        )
      `)
      .eq('asin', asin.toUpperCase())
      .eq('is_active', true)
      .maybeSingle();

    if (listingError) {
      throw listingError;
    }

    if (!listing || !listing.boms) {
      return sendSuccess(res, {
        asin: asin.toUpperCase(),
        hasLinkedBom: false,
        message: 'No BOM linked to this ASIN. Use POST /profit/analyze with components.',
      });
    }

    // Build components array from BOM
    const components = listing.boms.bom_components.map(bc => ({
      component_id: bc.component_id,
      qty_required: bc.qty_required,
    }));

    // Redirect to full analysis
    req.body = {
      asin,
      components,
      sizeTier: 'standard',
      targetMarginPercent: 10,
    };

    // Call the analyze endpoint logic directly
    // (In production, you might want to refactor to share logic)
    return res.redirect(307, `/profit/analyze`);
  } catch (err) {
    console.error('Quick profit check error:', err);
    errors.internal(res, 'Failed to perform quick profit check');
  }
});

export default router;
