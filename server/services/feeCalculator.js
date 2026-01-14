/**
 * Amazon Fee Calculator Service
 * Calculates FBA fees, referral fees, and net profit margins
 *
 * Fee rates are for Amazon UK (configurable)
 * All monetary values in pence
 */

// Default Amazon UK fee configuration
// These can be overridden via settings
const DEFAULT_FEE_CONFIG = {
  // Referral fee percentage by category (most categories are 15%)
  referralFeePercent: 15,
  referralFeeMinPence: 30, // Minimum 30p referral fee

  // FBA Fulfillment fees (simplified - based on size tiers)
  // In reality these vary by size/weight, but this gives good estimates
  fbaFees: {
    small: 214,      // Small envelope: £2.14
    standard: 295,   // Standard: £2.95
    large: 450,      // Large: £4.50
    oversize: 850,   // Oversize: £8.50+
  },

  // Default size tier for unknown items
  defaultSizeTier: 'standard',

  // VAT rate (for gross-up calculations)
  vatRate: 20,

  // Closing fee (media items only - books, DVDs etc)
  closingFeePence: 50,
  mediaCategories: ['Books', 'DVD', 'Music', 'Video Games'],
};

/**
 * Calculate Amazon referral fee
 * @param {number} priceInPence - Selling price in pence
 * @param {object} config - Fee configuration
 * @returns {number} Referral fee in pence
 */
function calculateReferralFee(priceInPence, config = DEFAULT_FEE_CONFIG) {
  const percentFee = Math.round(priceInPence * (config.referralFeePercent / 100));
  return Math.max(percentFee, config.referralFeeMinPence);
}

/**
 * Calculate FBA fulfillment fee based on size tier
 * @param {string} sizeTier - Size tier: 'small', 'standard', 'large', 'oversize'
 * @param {object} config - Fee configuration
 * @returns {number} FBA fee in pence
 */
function calculateFbaFee(sizeTier = 'standard', config = DEFAULT_FEE_CONFIG) {
  return config.fbaFees[sizeTier] || config.fbaFees[config.defaultSizeTier];
}

/**
 * Determine size tier from product dimensions (simplified)
 * @param {object} dimensions - { lengthCm, widthCm, heightCm, weightGrams }
 * @returns {string} Size tier
 */
function determineSizeTier(dimensions) {
  if (!dimensions) return 'standard';

  const { lengthCm = 0, widthCm = 0, heightCm = 0, weightGrams = 0 } = dimensions;

  // Small envelope: max 20x15x1cm, under 80g
  if (lengthCm <= 20 && widthCm <= 15 && heightCm <= 1 && weightGrams <= 80) {
    return 'small';
  }

  // Standard: max 45x34x26cm, under 12kg
  if (lengthCm <= 45 && widthCm <= 34 && heightCm <= 26 && weightGrams <= 12000) {
    return 'standard';
  }

  // Large: max 61x46x46cm, under 23kg
  if (lengthCm <= 61 && widthCm <= 46 && heightCm <= 46 && weightGrams <= 23000) {
    return 'large';
  }

  // Oversize: everything else
  return 'oversize';
}

/**
 * Calculate all Amazon fees for a product
 * @param {object} params
 * @param {number} params.priceInPence - Selling price in pence
 * @param {string} params.sizeTier - Size tier (optional, defaults to 'standard')
 * @param {string} params.category - Product category (optional, for closing fee)
 * @param {object} params.config - Fee configuration override
 * @returns {object} Fee breakdown
 */
function calculateAllFees({ priceInPence, sizeTier = 'standard', category = null, config = DEFAULT_FEE_CONFIG }) {
  const referralFee = calculateReferralFee(priceInPence, config);
  const fbaFee = calculateFbaFee(sizeTier, config);

  // Closing fee only for media categories
  let closingFee = 0;
  if (category && config.mediaCategories.includes(category)) {
    closingFee = config.closingFeePence;
  }

  const totalFees = referralFee + fbaFee + closingFee;

  return {
    referralFee,
    fbaFee,
    closingFee,
    totalFees,
    feeBreakdown: {
      referralFeePercent: config.referralFeePercent,
      referralFeeAmount: referralFee,
      fbaFeeAmount: fbaFee,
      closingFeeAmount: closingFee,
      sizeTier,
    }
  };
}

/**
 * Calculate profit and margins for a product
 * @param {object} params
 * @param {number} params.sellingPricePence - Selling price in pence
 * @param {number} params.costPence - Total product cost (COGS) in pence
 * @param {string} params.sizeTier - Size tier for FBA fees
 * @param {string} params.category - Product category
 * @param {object} params.config - Fee configuration override
 * @returns {object} Profit analysis
 */
function calculateProfit({ sellingPricePence, costPence, sizeTier = 'standard', category = null, config = DEFAULT_FEE_CONFIG }) {
  const fees = calculateAllFees({ priceInPence: sellingPricePence, sizeTier, category, config });

  const grossProfit = sellingPricePence - costPence;
  const netProfit = sellingPricePence - costPence - fees.totalFees;
  const grossMarginPercent = sellingPricePence > 0 ? (grossProfit / sellingPricePence) * 100 : 0;
  const netMarginPercent = sellingPricePence > 0 ? (netProfit / sellingPricePence) * 100 : 0;
  const roi = costPence > 0 ? (netProfit / costPence) * 100 : 0;

  return {
    sellingPricePence,
    costPence,
    fees: fees.totalFees,
    feeBreakdown: fees.feeBreakdown,
    grossProfit,
    netProfit,
    grossMarginPercent: Math.round(grossMarginPercent * 10) / 10,
    netMarginPercent: Math.round(netMarginPercent * 10) / 10,
    roi: Math.round(roi * 10) / 10,
    isProfitable: netProfit > 0,
  };
}

/**
 * Calculate the minimum selling price needed for a target margin
 * @param {object} params
 * @param {number} params.costPence - Product cost in pence
 * @param {number} params.targetMarginPercent - Target net margin (e.g., 10 for 10%)
 * @param {string} params.sizeTier - Size tier for FBA fees
 * @param {object} params.config - Fee configuration
 * @returns {object} Target price analysis
 */
function calculateTargetPrice({ costPence, targetMarginPercent, sizeTier = 'standard', config = DEFAULT_FEE_CONFIG }) {
  const fbaFee = calculateFbaFee(sizeTier, config);

  // Net Profit = Price - Cost - ReferralFee - FBAFee
  // Net Profit = Price * targetMargin / 100
  // Therefore: Price * (targetMargin/100) = Price - Cost - (Price * referralPercent/100) - FBAFee
  // Price * (targetMargin/100 + referralPercent/100) = Price - Cost - FBAFee
  // Price * (1 - targetMargin/100 - referralPercent/100) = Cost + FBAFee
  // Price = (Cost + FBAFee) / (1 - targetMargin/100 - referralPercent/100)

  const referralPercent = config.referralFeePercent;
  const divisor = 1 - (targetMarginPercent / 100) - (referralPercent / 100);

  if (divisor <= 0) {
    // Target margin is impossible with current fee structure
    return {
      targetPricePence: null,
      achievable: false,
      reason: `Target margin of ${targetMarginPercent}% is not achievable with ${referralPercent}% referral fee`,
    };
  }

  const targetPricePence = Math.ceil((costPence + fbaFee) / divisor);

  // Verify with actual calculation (referral fee has a minimum)
  const verification = calculateProfit({
    sellingPricePence: targetPricePence,
    costPence,
    sizeTier,
    config
  });

  // Adjust if minimum referral fee kicks in
  if (verification.netMarginPercent < targetMarginPercent - 0.5) {
    // Iterate to find exact price
    let adjustedPrice = targetPricePence;
    for (let i = 0; i < 100; i++) {
      adjustedPrice += 10; // Add 10p increments
      const check = calculateProfit({
        sellingPricePence: adjustedPrice,
        costPence,
        sizeTier,
        config
      });
      if (check.netMarginPercent >= targetMarginPercent) {
        return {
          targetPricePence: adjustedPrice,
          achievable: true,
          verification: check,
        };
      }
    }
  }

  return {
    targetPricePence,
    achievable: true,
    verification,
  };
}

/**
 * Calculate break-even price (0% margin)
 * @param {number} costPence - Product cost in pence
 * @param {string} sizeTier - Size tier
 * @param {object} config - Fee configuration
 * @returns {number} Break-even price in pence
 */
function calculateBreakEvenPrice(costPence, sizeTier = 'standard', config = DEFAULT_FEE_CONFIG) {
  const result = calculateTargetPrice({
    costPence,
    targetMarginPercent: 0,
    sizeTier,
    config
  });
  return result.targetPricePence;
}

export {
  DEFAULT_FEE_CONFIG,
  calculateReferralFee,
  calculateFbaFee,
  determineSizeTier,
  calculateAllFees,
  calculateProfit,
  calculateTargetPrice,
  calculateBreakEvenPrice,
};
