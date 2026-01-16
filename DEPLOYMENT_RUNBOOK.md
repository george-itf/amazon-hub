# Deployment Runbook — UX Audit Implementation

## Overview

This runbook provides step-by-step instructions for deploying the P0, P1, and 1-Month milestone changes from the UX audit implementation.

**Estimated Total Time**: 30-45 minutes
**Risk Level**: Low (all changes are additive/backward compatible)
**Rollback Time**: 5 minutes per component

---

## Pre-Deployment Checklist

- [ ] All 241 tests passing locally (`cd server && npm test`)
- [ ] Database backup taken (Supabase dashboard → Settings → Backups)
- [ ] Notify ops team of deployment window
- [ ] Railway deployment credentials available
- [ ] Vercel deployment credentials available

---

## Step 1: Database Migrations (Supabase)

### 1.1 Stock Movements Enhancement

**Time**: 2 minutes
**Risk**: Low (additive columns)

```sql
-- Run in Supabase SQL Editor

-- Add idempotency tracking to stock movements
ALTER TABLE stock_movements
ADD COLUMN IF NOT EXISTS idempotency_key text;

ALTER TABLE stock_movements
ADD COLUMN IF NOT EXISTS before_on_hand integer;

ALTER TABLE stock_movements
ADD COLUMN IF NOT EXISTS after_on_hand integer;

CREATE INDEX IF NOT EXISTS idx_stock_movements_idempotency
ON stock_movements(idempotency_key);
```

**Verification**:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'stock_movements'
AND column_name IN ('idempotency_key', 'before_on_hand', 'after_on_hand');
-- Should return 3 rows
```

---

### 1.2 Saved Views Table

**Time**: 3 minutes
**Risk**: Low (new table)

```sql
-- Run in Supabase SQL Editor

-- Drop existing table if any (safe for fresh install)
DROP TABLE IF EXISTS ui_views CASCADE;

-- Create the complete ui_views table
CREATE TABLE ui_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page text NOT NULL CHECK (page IN ('components', 'listings', 'orders', 'shipping', 'boms', 'returns', 'analytics', 'review', 'inventory', 'audit')),
  name text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}',
  columns text[] DEFAULT '{}',
  sort jsonb DEFAULT '{}',
  user_id uuid,
  is_default boolean DEFAULT false,
  is_shared boolean DEFAULT false,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX idx_ui_views_page ON ui_views(page);
CREATE INDEX idx_ui_views_page_sort ON ui_views(page, sort_order);
CREATE INDEX idx_ui_views_user_page ON ui_views(user_id, page);
CREATE INDEX idx_ui_views_shared ON ui_views(page, is_shared) WHERE is_shared = true;
CREATE UNIQUE INDEX idx_ui_views_user_page_name ON ui_views(user_id, page, name) WHERE user_id IS NOT NULL;

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_ui_views_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ui_views_updated_at
  BEFORE UPDATE ON ui_views
  FOR EACH ROW
  EXECUTE FUNCTION update_ui_views_updated_at();

-- Helper function
CREATE OR REPLACE FUNCTION get_user_views(p_user_id uuid, p_page text)
RETURNS TABLE (
  id uuid, name text, filters jsonb, columns text[], sort jsonb,
  is_default boolean, is_shared boolean, is_owner boolean,
  sort_order integer, created_at timestamptz, updated_at timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT v.id, v.name, v.filters, v.columns, v.sort, v.is_default, v.is_shared,
         (v.user_id = p_user_id) AS is_owner, v.sort_order, v.created_at, v.updated_at
  FROM ui_views v
  WHERE v.page = p_page
    AND (v.user_id = p_user_id OR v.is_shared = true OR v.user_id IS NULL)
  ORDER BY v.is_default DESC, v.sort_order ASC, v.name ASC;
END;
$$ LANGUAGE plpgsql STABLE;

-- Comments
COMMENT ON TABLE ui_views IS 'User-defined saved views with filters, columns, and sort configuration';
```

**Verification**:
```sql
SELECT * FROM ui_views LIMIT 1;
-- Should return empty result (no error)

SELECT get_user_views(NULL, 'shipping');
-- Should return empty result (no error)
```

---

### 1.3 Shipping Batches Tables (if not exists)

**Time**: 2 minutes
**Risk**: Low (new tables)

```sql
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS shipping_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id text UNIQUE NOT NULL,
  status text NOT NULL CHECK (status IN ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  dry_run boolean DEFAULT false,
  service_code text,
  total_orders int,
  successful_orders int DEFAULT 0,
  failed_orders int DEFAULT 0,
  skipped_orders int DEFAULT 0,
  total_cost_pence int DEFAULT 0,
  user_id uuid,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  duration_ms int
);

CREATE TABLE IF NOT EXISTS shipping_batch_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid REFERENCES shipping_batches(id) ON DELETE CASCADE,
  order_id uuid,
  order_name text,
  status text CHECK (status IN ('SUCCESS', 'FAILED', 'SKIPPED')),
  tracking_number text,
  label_url text,
  price_pence int,
  error_message text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shipping_batches_created ON shipping_batches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipping_batches_user ON shipping_batches(user_id);
CREATE INDEX IF NOT EXISTS idx_shipping_batch_results_batch ON shipping_batch_results(batch_id);
```

**Verification**:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('shipping_batches', 'shipping_batch_results');
-- Should return 2 rows
```

---

## Step 2: Deploy Backend (Railway)

**Time**: 5-10 minutes
**Risk**: Low

### 2.1 Deploy via Railway Dashboard

1. Go to Railway dashboard → Amazon Hub project
2. Click on the backend service
3. Trigger redeploy (or push to main branch)
4. Wait for deployment to complete (green status)

### 2.2 Deploy via CLI (Alternative)

```bash
cd server
railway up
```

### 2.3 Verification

```bash
# Health check
curl https://your-api-domain.railway.app/api/health

# Expected response:
# {"ok":true,"timestamp":"...","version":"..."}
```

```bash
# Test error codes endpoint
curl https://your-api-domain.railway.app/api/shipping/services

# Should return service options without error
```

---

## Step 3: Deploy Frontend (Vercel)

**Time**: 5-10 minutes
**Risk**: Low

### 3.1 Deploy via Vercel Dashboard

1. Go to Vercel dashboard → Amazon Hub project
2. Click "Redeploy" on latest deployment
3. Or push to main branch for automatic deployment
4. Wait for deployment to complete

### 3.2 Deploy via CLI (Alternative)

```bash
cd client
vercel --prod
```

### 3.3 Verification

1. Open https://your-domain.vercel.app
2. Log in with test account
3. Verify navigation loads (check for Admin section with Audit link)

---

## Step 4: Post-Deployment Verification

### 4.1 P0 Verification Checklist

| Test | Steps | Expected Result |
|------|-------|-----------------|
| **Stock Idempotency** | Open Inventory → Adjust stock → Double-click confirm | Only ONE adjustment created |
| **Stock Mode Toggle** | Open Inventory → Adjust stock | See "Set stock to" / "Change by" radio buttons |
| **Shipping Status Gate** | Create batch with READY_TO_PICK order | Should be rejected with clear error |
| **Shipping Batch Limit** | Select 101 orders | "Create Labels" button disabled |
| **Error Correlation ID** | Trigger any error | See correlation ID with copy button |

### 4.2 P1 Verification Checklist

| Test | Steps | Expected Result |
|------|-------|-----------------|
| **Allocation Confirmation** | Run allocation → Click Apply | See confirmation modal with scope summary |
| **Allocation Staleness** | Run preview → Wait 6 min → Apply | See staleness warning |
| **Shipping Preflight** | Select orders → Click Create Labels | See preflight modal before batch starts |
| **Shipping History** | Create a batch | See batch in history table |
| **Logout Confirmation** | Click Sign Out | See confirmation modal |
| **Nav Keyboard** | Tab to nav items → Press Enter | Items activate correctly |

### 4.3 1-Month Verification Checklist

| Test | Steps | Expected Result |
|------|-------|-----------------|
| **Audit Page** | Navigate to /audit | Page loads with filters |
| **Audit Filtering** | Select entity type filter | Table filters correctly |
| **Saved Views** | Shipping → Save current view | View appears in saved views bar |
| **HubTable Shipping** | Open Shipping page | See HubTable with filters, columns |
| **HubTable Listings** | Open Listings page | See HubTable with bulk actions |
| **Column Management** | Click column settings | Can show/hide columns |

---

## Step 5: Smoke Test Script

Run this checklist within 15 minutes of deployment:

```
□ 1. Login works
□ 2. Dashboard loads without errors
□ 3. Inventory page loads
□ 4. Can open stock adjustment modal (see mode toggle)
□ 5. Shipping page loads with HubTable
□ 6. Can see batch limit warning when selecting many orders
□ 7. Listings page loads with HubTable
□ 8. Can see bulk actions bar when selecting listings
□ 9. Allocation page loads
□ 10. Can run allocation preview
□ 11. Audit page loads at /audit
□ 12. Can filter audit by entity type
□ 13. Admin section visible in navigation
□ 14. Sign out shows confirmation modal
□ 15. Error displays show correlation ID (trigger by invalid action)
```

---

## Rollback Procedures

### Rollback Frontend

```bash
# Via Vercel Dashboard
# 1. Go to Deployments
# 2. Find previous deployment
# 3. Click "..." → "Promote to Production"

# Or via CLI
vercel rollback
```

### Rollback Backend

```bash
# Via Railway Dashboard
# 1. Go to Deployments
# 2. Find previous deployment
# 3. Click "Redeploy"

# Or revert git commit and push
git revert HEAD
git push origin main
```

### Rollback Database

Database changes are additive and don't need rollback. If needed:

```sql
-- Remove new columns (NOT RECOMMENDED unless critical)
ALTER TABLE stock_movements DROP COLUMN IF EXISTS idempotency_key;
ALTER TABLE stock_movements DROP COLUMN IF EXISTS before_on_hand;
ALTER TABLE stock_movements DROP COLUMN IF EXISTS after_on_hand;

-- Drop saved views table
DROP TABLE IF EXISTS ui_views CASCADE;

-- Drop shipping batch tables
DROP TABLE IF EXISTS shipping_batch_results CASCADE;
DROP TABLE IF EXISTS shipping_batches CASCADE;
```

---

## Monitoring

### Key Metrics to Watch (First 24 Hours)

1. **Error Rate**: Should not increase
   - Check Railway logs for 500 errors
   - Check Supabase logs for query failures

2. **API Response Time**: Should not degrade
   - `/api/shipping/orders/ready` — target <500ms
   - `/api/inventory/components` — target <1s

3. **User Reports**: Monitor support channels for:
   - "Can't adjust stock" → Check idempotency
   - "Can't create labels" → Check status gating
   - "Page won't load" → Check frontend deployment

### Log Queries (Railway)

```bash
# Check for errors in last hour
railway logs --filter "error" --since 1h

# Check for specific correlation ID
railway logs --filter "correlation_id=abc123"
```

### Supabase Query (Check for Issues)

```sql
-- Recent failed stock adjustments
SELECT * FROM stock_movements
WHERE created_at > now() - interval '1 hour'
ORDER BY created_at DESC
LIMIT 20;

-- Recent shipping batches
SELECT * FROM shipping_batches
WHERE created_at > now() - interval '1 hour'
ORDER BY created_at DESC;
```

---

## Support Escalation

| Issue | First Response | Escalation |
|-------|---------------|------------|
| Can't log in | Check auth service | Backend team |
| Stock adjustment fails | Check idempotency key in logs | Backend team |
| Shipping batch fails | Check Royal Mail API status | Backend team |
| Page won't load | Check Vercel deployment status | Frontend team |
| Data looks wrong | Check recent migrations | Database team |

---

## Deployment Complete Checklist

- [ ] All SQL migrations executed successfully
- [ ] Backend deployed and healthy
- [ ] Frontend deployed and accessible
- [ ] Smoke tests passed
- [ ] Ops team notified of completion
- [ ] Monitoring dashboard reviewed (no anomalies)

**Deployment Completed**: _________________ (timestamp)
**Deployed By**: _________________
**Verified By**: _________________
