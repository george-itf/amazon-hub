import { z } from 'zod';

// =========================================
// Common validators
// =========================================

/**
 * Safe URL validator - validates URL format and prevents malicious URLs
 */
export const safeUrlSchema = z.string().url().refine(
  (url) => {
    try {
      const parsed = new URL(url);
      // Only allow http/https protocols
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  },
  { message: 'Invalid or unsafe URL' }
);

/**
 * UUID validator
 */
export const uuidSchema = z.string().uuid();

/**
 * Positive integer validator
 */
export const positiveIntSchema = z.number().int().positive();

/**
 * Non-negative integer validator (for prices in pence)
 */
export const nonNegativeIntSchema = z.number().int().nonnegative();

/**
 * Pagination parameters
 */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0)
});

// =========================================
// Component schemas
// =========================================

export const componentCreateSchema = z.object({
  internal_sku: z.string().min(1).max(50),
  description: z.string().max(500).optional(),
  brand: z.string().max(100).optional(),
  unit_cost_pence: nonNegativeIntSchema.optional(),
  cost_ex_vat_pence: nonNegativeIntSchema.optional(),
  is_active: z.boolean().default(true)
});

export const componentUpdateSchema = componentCreateSchema.partial();

export const componentIdSchema = z.object({
  id: z.coerce.number().int().positive()
});

// =========================================
// BOM schemas
// =========================================

export const bomComponentSchema = z.object({
  component_id: positiveIntSchema,
  qty_required: positiveIntSchema
});

export const bomCreateSchema = z.object({
  bundle_sku: z.string().min(1).max(50),
  description: z.string().max(500).optional(),
  is_active: z.boolean().default(true),
  components: z.array(bomComponentSchema).min(1).optional()
});

export const bomUpdateSchema = bomCreateSchema.partial();

// =========================================
// Stock schemas
// =========================================

export const stockAdjustSchema = z.object({
  component_id: positiveIntSchema,
  location: z.string().min(1).max(50).default('DEFAULT'),
  on_hand_delta: z.number().int().default(0),
  reserved_delta: z.number().int().default(0),
  reason: z.enum([
    'RECEIVE', 'ADJUSTMENT', 'TRANSFER', 'COUNT',
    'DAMAGE', 'RETURN', 'SALE', 'RESERVE', 'RELEASE'
  ]),
  note: z.string().max(500).optional(),
  reference_type: z.string().max(50).optional(),
  reference_id: z.string().max(100).optional()
});

export const stockReceiveSchema = z.object({
  component_id: positiveIntSchema,
  quantity: positiveIntSchema,
  location: z.string().min(1).max(50).default('DEFAULT'),
  note: z.string().max(500).optional()
});

// =========================================
// Order schemas
// =========================================

export const orderStatusSchema = z.enum([
  'PENDING', 'CONFIRMED', 'PICKING', 'PICKED',
  'DISPATCHED', 'CANCELLED', 'HOLD'
]);

export const orderLineSchema = z.object({
  title: z.string().max(500),
  asin: z.string().max(20).optional(),
  sku: z.string().max(50).optional(),
  quantity: positiveIntSchema,
  unit_price_pence: nonNegativeIntSchema.optional(),
  bom_id: positiveIntSchema.optional()
});

export const orderCreateSchema = z.object({
  external_order_id: z.string().max(100),
  source: z.enum(['SHOPIFY', 'AMAZON', 'MANUAL', 'OTHER']).default('MANUAL'),
  status: orderStatusSchema.default('PENDING'),
  order_date: z.string().datetime().optional(),
  customer_email: z.string().email().max(255).optional(),
  customer_name: z.string().max(200).optional(),
  total_price_pence: nonNegativeIntSchema.optional(),
  currency: z.string().length(3).default('GBP'),
  lines: z.array(orderLineSchema).min(1)
});

// =========================================
// Listing/Memory schemas
// =========================================

export const listingMemorySchema = z.object({
  asin: z.string().min(10).max(12).optional(),
  sku: z.string().max(50).optional(),
  title_fingerprint: z.string().max(500).optional(),
  bom_id: positiveIntSchema,
  source: z.enum(['ASIN', 'SKU', 'FINGERPRINT']),
  is_active: z.boolean().default(true)
});

// =========================================
// Review queue schemas
// =========================================

export const reviewResolveSchema = z.object({
  order_line_id: positiveIntSchema,
  resolution: z.enum(['MAP_BOM', 'SKIP', 'MANUAL']),
  bom_id: positiveIntSchema.optional(),
  remember: z.boolean().default(false),
  memory_source: z.enum(['ASIN', 'SKU', 'FINGERPRINT']).optional()
});

// =========================================
// Analytics query schemas
// =========================================

export const dateRangeSchema = z.object({
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
}).refine(
  (data) => {
    if (data.start_date && data.end_date) {
      return new Date(data.start_date) <= new Date(data.end_date);
    }
    return true;
  },
  { message: 'start_date must be before or equal to end_date' }
);

export const analyticsQuerySchema = dateRangeSchema.extend({
  granularity: z.enum(['daily', 'weekly', 'monthly']).default('daily'),
  sort_by: z.enum(['revenue', 'quantity', 'profit', 'margin']).default('revenue'),
  limit: z.coerce.number().int().min(1).max(500).default(50)
});

// =========================================
// Audit schemas
// =========================================

export const auditEntityTypeSchema = z.enum([
  'COMPONENT', 'BOM', 'LISTING', 'ORDER', 'ORDER_LINE',
  'PICK_BATCH', 'RETURN', 'REVIEW_ITEM', 'USER', 'SETTING',
  'STOCK', 'SYSTEM'
]);

export const auditActionSchema = z.enum([
  'CREATE', 'UPDATE', 'DELETE', 'RESOLVE', 'SKIP', 'CANCEL',
  'RESERVE', 'CONFIRM', 'RECEIVE', 'ADJUST', 'IMPORT', 'EXPORT',
  'LOGIN', 'LOGOUT', 'SUPERSEDE', 'REQUEUE'
]);

export const auditLogEntrySchema = z.object({
  entityType: auditEntityTypeSchema,
  entityId: z.string().max(100),
  action: auditActionSchema,
  beforeJson: z.record(z.unknown()).optional(),
  afterJson: z.record(z.unknown()).optional(),
  changesSummary: z.string().max(1000).optional()
});

// =========================================
// Keepa schemas
// =========================================

export const asinSchema = z.string().regex(/^[A-Z0-9]{10}$/, 'Invalid ASIN format');

export const keepaRefreshSchema = z.object({
  asins: z.array(asinSchema).min(1).max(100)
});

// =========================================
// Helper function to validate and parse
// =========================================

/**
 * Validate request body against schema
 * @param {z.ZodSchema} schema - Zod schema to validate against
 * @param {object} data - Data to validate
 * @returns {{ success: boolean, data?: object, error?: string }}
 */
export function validateRequest(schema, data) {
  try {
    const result = schema.safeParse(data);
    if (result.success) {
      return { success: true, data: result.data };
    }
    const errorMessages = result.error.errors
      .map(e => `${e.path.join('.')}: ${e.message}`)
      .join(', ');
    return { success: false, error: errorMessages };
  } catch (err) {
    return { success: false, error: 'Validation failed' };
  }
}

/**
 * Express middleware factory for request validation
 * @param {z.ZodSchema} schema - Zod schema to validate against
 * @param {'body' | 'query' | 'params'} source - Where to get data from
 */
export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const data = req[source];
    const result = validateRequest(schema, data);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: result.error
        }
      });
    }

    req.validated = result.data;
    next();
  };
}
