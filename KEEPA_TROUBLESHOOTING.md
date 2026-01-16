# Keepa API Troubleshooting Guide

## Issue: Keepa API Not Pulling Information

### Quick Diagnosis

Run these commands to diagnose the issue:

```bash
# 1. Check if KEEPA_API_KEY is set in Railway
railway variables
# or check in Railway dashboard: Settings > Variables

# 2. Test Keepa status endpoint
curl https://amazon-hub-production.up.railway.app/keepa/status

# 3. Check recent Keepa logs
railway logs | grep -i keepa | tail -20
```

### Common Causes & Solutions

#### 1. **API Key Not Configured** ❌
**Symptoms:**
- `/keepa/status` shows `"configured": false`
- Error: "KEEPA_API_KEY not configured"

**Solution:**
```bash
# Set the API key in Railway
railway variables set KEEPA_API_KEY=your-actual-api-key-here

# Restart the service
railway up
```

#### 2. **API Key Invalid** ❌
**Symptoms:**
- `/keepa/status` shows `"configured": true` but requests fail
- Error: "ACCESS_DENIED" from Keepa API

**Solution:**
- Verify your API key at https://keepa.com/#!api
- Check if your Keepa account is active
- Ensure the API key hasn't expired

#### 3. **Token Budget Exceeded** ⚠️
**Symptoms:**
- Error: "HOURLY_BUDGET_EXCEEDED" or "DAILY_BUDGET_EXCEEDED"
- `/keepa/status` shows `tokens_remaining_hour: 0`

**Solution:**
```bash
# Check current budget usage
curl https://amazon-hub-production.up.railway.app/keepa/status

# Adjust budget limits (if needed)
curl -X PUT https://amazon-hub-production.up.railway.app/keepa/settings \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "max_tokens_per_hour": 1000,
    "max_tokens_per_day": 8000
  }'
```

#### 4. **Stale Cache** 🔄
**Symptoms:**
- Data appears outdated
- Recent price changes not reflected

**Solution:**
```bash
# Force refresh a specific product
curl "https://amazon-hub-production.up.railway.app/keepa/product/ASIN?force_refresh=true" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Or refresh multiple ASINs (admin only)
curl -X POST https://amazon-hub-production.up.railway.app/keepa/refresh \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "asins": ["B07ZPKN6YR", "B08N5WRWNW"]
  }'
```

#### 5. **Network/Connectivity Issues** 🌐
**Symptoms:**
- Timeout errors
- Intermittent failures

**Solution:**
- Check Keepa API status: https://status.keepa.com/
- Verify Railway deployment is running
- Check server logs for network errors

### Verification Steps

#### Step 1: Check Configuration
```bash
curl https://amazon-hub-production.up.railway.app/keepa/status
```

**Expected Response:**
```json
{
  "ok": true,
  "data": {
    "configured": true,  // ← Should be true
    "domain_id": 2,
    "budget": {
      "max_tokens_per_hour": 800,
      "max_tokens_per_day": 6000,
      "tokens_spent_hour": 45,
      "tokens_spent_day": 234,
      "tokens_remaining_hour": 755,  // ← Should be > 0
      "tokens_remaining_day": 5766   // ← Should be > 0
    },
    "account": {
      "tokens_left": 12500,  // ← Your actual Keepa account balance
      "refill_rate": 60
    },
    "cache": {
      "total_products": 150,
      "stale_products": 5
    }
  }
}
```

#### Step 2: Test a Product Request
```bash
curl "https://amazon-hub-production.up.railway.app/keepa/product/B07ZPKN6YR" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Success Response:**
```json
{
  "ok": true,
  "data": {
    "asin": "B07ZPKN6YR",
    "metrics": {
      "buybox_price_pence": 12999,
      "sales_rank": 5432,
      "rating": 4.5,
      "review_count": 1234
    },
    "from_cache": false,
    "tokens_spent": 1
  }
}
```

**Error Response (if API key missing):**
```json
{
  "ok": false,
  "error": {
    "message": "Keepa API not configured",
    "code": "BAD_REQUEST"
  }
}
```

### Manual API Test

To test the Keepa API directly (bypassing the app):

```bash
# Replace YOUR_KEEPA_API_KEY with your actual key
curl "https://api.keepa.com/product?key=YOUR_KEEPA_API_KEY&domain=2&asin=B07ZPKN6YR&stats=90"
```

**Successful Response Indicators:**
- HTTP 200 status
- `tokensLeft` field shows remaining tokens
- `products` array contains data

**Failed Response Indicators:**
- HTTP 401/403 status
- `error: "ACCESS_DENIED"`
- Empty `products` array

### Database Check

Check if Keepa data is being stored:

```sql
-- Check cached products
SELECT asin, fetched_at, expires_at
FROM keepa_products_cache
ORDER BY fetched_at DESC
LIMIT 10;

-- Check request log
SELECT requested_at, endpoint, status, tokens_spent, error_message
FROM keepa_request_log
ORDER BY requested_at DESC
LIMIT 10;

-- Check account balance history
SELECT recorded_at, tokens_left, refill_rate
FROM keepa_account_balance
ORDER BY recorded_at DESC
LIMIT 5;
```

### Settings Reference

Default Keepa settings in database (`keepa_settings` table):

| Setting Key | Default Value | Description |
|------------|---------------|-------------|
| `max_tokens_per_hour` | 800 | Maximum tokens to spend per hour |
| `max_tokens_per_day` | 6000 | Maximum tokens to spend per day |
| `min_reserve` | 200 | Reserve tokens (safety buffer) |
| `min_refresh_minutes` | 720 | Cache TTL (12 hours) |
| `domain_id` | 2 | Amazon domain (2 = UK) |

### Contact Keepa Support

If the API key is configured correctly but still not working:

1. Login to https://keepa.com/#!api
2. Check your account status and token balance
3. Verify the API key is active
4. Contact Keepa support if needed

### Logs to Check

When reporting issues, include:

1. **Keepa Status Response**: Output from `/keepa/status`
2. **Recent Request Logs**: Last 20 Keepa-related log entries
3. **Error Messages**: Any error messages from failed requests
4. **Token Balance**: Current `tokensLeft` from Keepa API

### Common Error Messages

| Error Message | Cause | Solution |
|--------------|-------|----------|
| `KEEPA_API_KEY not configured` | Environment variable not set | Set KEEPA_API_KEY in Railway |
| `ACCESS_DENIED` | Invalid/expired API key | Check API key at keepa.com |
| `HOURLY_BUDGET_EXCEEDED` | Reached hourly token limit | Wait or increase budget |
| `DAILY_BUDGET_EXCEEDED` | Reached daily token limit | Wait or increase budget |
| `Product not found` | ASIN doesn't exist | Verify ASIN is correct |
| `Request timeout` | Network/connectivity issue | Check Railway logs |

### Need Help?

1. Check Railway logs: `railway logs | grep -i keepa`
2. Review this guide again
3. Test with `curl` commands above
4. Check Keepa account at https://keepa.com
5. Contact system administrator with logs
