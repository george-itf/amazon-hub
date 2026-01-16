# Amazon Hub - Claude Cowork Handoff Prompt

## Project Overview

This is **Amazon Hub**, a full-stack inventory management and profit analysis system for Amazon UK sellers. It integrates with the **Keepa API** for product data, pricing history, and sales rank tracking.

**Tech Stack:**
- **Frontend**: React + Vite, TailwindCSS, hosted on Vercel
- **Backend**: Node.js + Express (ESM modules), hosted on Railway
- **Database**: Supabase (PostgreSQL with Row Level Security)
- **External APIs**: Keepa API (UK domain only - amazon.co.uk)

---

## Critical Domain Knowledge

### Keepa API Integration (UK ONLY)
- **Domain ID**: `2` = amazon.co.uk (NEVER use domain 3 which is .de)
- **Base URL**: `https://api.keepa.com/product`
- **Token Cost**: 1 token per product lookup
- **Free Parameter**: `&stats=90` provides 90-day price statistics (min/max/avg) at no extra token cost

### Keepa CSV Indices (Memorize These!)
```javascript
CSV_INDICES = {
  AMAZON: 0,      // Amazon's own price
  NEW: 1,         // New 3rd party price
  USED: 2,        // Used price
  SALES_RANK: 3,  // Sales rank history
  FBM_SHIPPING: 7,// FBM shipping cost
  FBA: 10,        // FBA offers price
  OFFER_COUNT: 11,// Number of offers
  RATING: 16,     // Product rating (divide by 10 for stars)
  REVIEW_COUNT: 17,// Number of reviews
  BUY_BOX: 18,    // Buy box price
}
```

### Keepa Special Values
- `-1` = No data available
- `-2` = Item is out of stock
- Prices are in **pence** (divide by 100 for pounds)
- Ratings are stored as integer (42 = 4.2 stars)

### CSV Data Format
Keepa CSV arrays are `[timestamp, value, timestamp, value, ...]` pairs. To get the latest value:
```javascript
function latestFromCsv(csv) {
  if (!csv || csv.length < 2) return null;
  const val = csv[csv.length - 1];
  return (val === -1 || val === -2) ? null : val;
}
```

---

## Key Files & Architecture

### Backend Services (`/server/`)

| File | Purpose |
|------|---------|
| `services/keepaService.js` | **CORE** - Shared Keepa API service with budget enforcement, caching, request logging |
| `routes/keepa.js` | Keepa endpoints - uses shared service |
| `routes/profit.js` | Profit analysis - uses shared service (was previously bypassing safeguards!) |
| `routes/dashboard.js` | Dashboard stats and metrics |
| `routes/preferences.js` | User preferences CRUD (cross-device sync) |
| `services/supabase.js` | Supabase client configuration |
| `middleware/correlationId.js` | Request tracking, error helpers |

### Database Migrations (`/server/db/migrations/`)

| Migration | Status | Purpose |
|-----------|--------|---------|
| `2026-01-15_user_preferences.sql` | ✅ Applied | User preferences table |
| `2026-01-16_performance_indexes.sql` | ⚠️ Fixed | Performance indexes (had wrong column names) |
| `2026-01-16_data_fixes.sql` | 🔄 NEEDS RUNNING | Fixes: user_preferences table, resets BOM assignments |
| `011_keepa_data_cleanup.sql` | 📋 New | Cleanup functions for request_log, account_balance |

### Frontend (`/client/src/`)
- React components in `/components/`
- API calls in `/services/api.js`
- State management via React Context

---

## Recent Changes & Fixes

### 1. Keepa Service Consolidation (MAJOR)
**Problem**: `profit.js` was making direct Keepa API calls, bypassing budget enforcement and logging.

**Solution**: Created `/server/services/keepaService.js` with:
- `getKeepaProduct(asin)` - Single product lookup with caching
- `refreshKeepaProducts(asins)` - Bulk refresh
- `extractKeepaMetrics(product)` - Standardized metric extraction
- `getCacheStats()` - Cache hit/miss tracking
- Budget enforcement (hourly/daily limits)
- Request logging to `request_log` table

### 2. Performance Index Fixes
**Problem**: Migration had wrong column/table names.

**Fixes Applied**:
- `components(sku)` → `components(internal_sku)`
- `demand_models` → `keepa_demand_model_runs`
- `demand_forecasts` → `keepa_demand_model_asin_features_cache`

### 3. Export Fix
**Problem**: `KEEPA_TOKENS_PER_PRODUCT` wasn't exported, causing server crash.

**Fix**: Changed `const` to `export const` in keepaService.js

---

## Current Production Issues (NEEDS ATTENTION)

### Issue 1: Listings Show "BOM ASSIGNED" Incorrectly
**Symptom**: All listings display "BOM ASSIGNED" status but no BOMs exist in the system.
**Root Cause**: `listing_memory.bom_id` has values but references non-existent BOMs.
**Fix**: Run migration `2026-01-16_data_fixes.sql` which resets all `bom_id` to NULL.

### Issue 2: Inventory Shows 0 Products
**Symptom**: Inventory page displays 0 products.
**Possible Causes**:
- `component_stock` table may be empty
- Components exist but no stock records created
**Diagnostic Query** (in migration file, commented out):
```sql
SELECT
  (SELECT COUNT(*) FROM components WHERE is_active = true) as active_components,
  (SELECT COUNT(*) FROM component_stock) as stock_records;
```

### Issue 3: PGRST205 Error (user_preferences table)
**Symptom**: Railway logs show `PGRST205: table 'public.user_prefrences' could not be found`
**Root Cause**: Table genuinely doesn't exist in production database.
**Fix**: Run migration `2026-01-16_data_fixes.sql` which creates the table.

---

## Immediate Action Items

1. **Run the data fixes migration** in Supabase SQL Editor:
   - Navigate to: Supabase Dashboard → SQL Editor
   - Open: `/server/db/migrations/2026-01-16_data_fixes.sql`
   - Execute the full script
   - This creates `user_preferences` table and resets BOM assignments

2. **Verify Railway deployment** succeeds after migration

3. **Check inventory data**:
   - If still showing 0, run the diagnostic query
   - May need to seed `component_stock` table

4. **Monitor Keepa cache efficiency**:
   - Check `GET /api/keepa/status` for cache hit rates
   - Reset stats with `POST /api/keepa/cache/reset-stats`

---

## Database Schema Quick Reference

### Core Tables
```
users                    - User accounts
listing_memory           - Amazon listings with bom_id FK
components              - Inventory components (internal_sku column)
component_stock         - Stock levels per component/location
boms                    - Bill of Materials definitions
bom_items               - BOM line items
user_preferences        - User settings (cross-device sync)
```

### Keepa Tables
```
keepa_cache             - Cached Keepa product data
keepa_metrics           - Extracted metrics from Keepa responses
request_log             - API request logging
account_balance         - Keepa token balance history
keepa_demand_model_runs - Demand model execution history
keepa_demand_model_asin_features_cache - Cached ASIN features
```

---

## Environment Variables

**Backend (Railway)**:
```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
KEEPA_API_KEY=xxx
NODE_ENV=production
```

**Frontend (Vercel)**:
```
VITE_API_URL=https://your-railway-app.up.railway.app
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

---

## Code Conventions

1. **ESM Modules**: All backend code uses ES modules (`import`/`export`)
2. **Named Exports**: Always use `export const` for functions/constants that need importing
3. **Error Handling**: Use `sendSuccess()` and `errors.xxx()` from correlationId middleware
4. **Supabase Queries**: Always handle `{ data, error }` response pattern
5. **Keepa Integration**: Always use shared `keepaService.js`, never direct API calls

---

## Useful Commands

```bash
# Start backend locally
cd server && npm run dev

# Start frontend locally
cd client && npm run dev

# Check git status
git status

# View recent commits
git log --oneline -10
```

---

## Questions? Check These Files First

- **API endpoints**: `/server/routes/*.js`
- **Database schema**: `/server/db/migrations/*.sql`
- **Keepa integration**: `/server/services/keepaService.js`
- **Frontend API calls**: `/client/src/services/api.js`

---

*Last Updated: 2026-01-16*
*Previous Session: Keepa consolidation, performance index fixes, data migration creation*
