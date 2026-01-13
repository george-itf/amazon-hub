# Amazon Hub Brain - Deployment Guide

## Overview

Amazon Hub Brain is a standalone web application for Invicta Tools & Fixings (UK) that provides an operational console for daily fulfilment, inventory management, and returns processing. It integrates with Shopify (read-only) and Keepa for market intelligence.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   React Client  │────▶│  Express API    │────▶│   Supabase/PG   │
│  (Polaris UI)   │     │  (Node.js)      │     │   (Database)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │    Shopify      │
                        │  (Read-Only)    │
                        └─────────────────┘
```

## Prerequisites

- Node.js 18+
- npm 9+
- Supabase project (or self-hosted PostgreSQL)
- Shopify API credentials (read-only access)
- Optional: Keepa API key for market intelligence

## Environment Setup

### 1. Clone and Install

```bash
git clone <repository-url>
cd amazon-hub

# Install server dependencies
cd server
npm install

# Install client dependencies
cd ../client
npm install
```

### 2. Configure Environment Variables

Create `.env` file in the `server` directory:

```env
# Server
PORT=3001
NODE_ENV=development

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key

# Session (generate with: openssl rand -base64 32)
SESSION_SECRET=your-session-secret-here

# Shopify (read-only)
SHOPIFY_STORE_URL=your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=your-access-token

# Keepa (optional)
KEEPA_API_KEY=your-keepa-api-key

# CORS
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

Create `.env` file in the `client` directory:

```env
VITE_API_BASE=http://localhost:3001
```

### 3. Database Setup

#### Option A: Supabase Cloud

1. Create a new Supabase project at https://supabase.com
2. Navigate to SQL Editor
3. Run migrations in order:
   - `server/db/migrations/001_initial_schema.sql`
   - `server/db/migrations/002_rpc_functions.sql`

#### Option B: Self-Hosted PostgreSQL

1. Create a database:
```sql
CREATE DATABASE amazon_hub_brain;
```

2. Run migrations:
```bash
psql -d amazon_hub_brain -f server/db/migrations/001_initial_schema.sql
psql -d amazon_hub_brain -f server/db/migrations/002_rpc_functions.sql
```

### 4. Seed Data (Development)

```bash
cd server
npm run seed
```

This creates:
- Admin user: `admin@invicta.local` / `admin123456`
- Staff user: `staff@invicta.local` / `staff123456`
- Sample components, BOMs, and listings

## Running the Application

### Development

```bash
# Terminal 1: Start server
cd server
npm run dev

# Terminal 2: Start client
cd client
npm run dev
```

Access at http://localhost:5173

### Production

```bash
# Build client
cd client
npm run build

# Start server (serves static files)
cd server
NODE_ENV=production npm start
```

## Production Deployment

### Railway Deployment

Railway auto-detects the `Dockerfile` at the repository root. No Railpack custom commands needed.

**Setup steps:**

1. Create a new project in Railway
2. Connect your GitHub repository
3. Railway will automatically detect the root Dockerfile and build
4. Configure environment variables in Railway dashboard:
   - `SUPABASE_URL` - Supabase project URL
   - `SUPABASE_ANON_KEY` - Supabase anon/public key
   - `SUPABASE_SERVICE_KEY` - Supabase service role key
   - `SESSION_SECRET` - Random 32+ byte string for sessions
   - `SHOPIFY_STORE_URL` - Your Shopify store domain
   - `SHOPIFY_ACCESS_TOKEN` - Shopify Admin API token
   - `ALLOWED_ORIGINS` - Your frontend domain(s) for CORS
   - `KEEPA_API_KEY` - (optional) Keepa API key
5. Railway automatically sets `PORT` - the server reads this at runtime
6. Deploy

**Notes:**
- The server listens on `process.env.PORT` (Railway provides this automatically)
- Default port is 3001 if PORT is not set
- Health check endpoint: `GET /health`
- The Docker build uses `npm ci` which requires `server/package-lock.json` (committed to repo)

### Docker Deployment (Manual)

A `Dockerfile` is provided at the repository root for the backend service:

```bash
# Build the image
docker build -t amazon-hub-brain .

# Run locally
docker run -p 3000:3000 \
  -e PORT=3000 \
  -e NODE_ENV=production \
  -e SUPABASE_URL=... \
  -e SUPABASE_ANON_KEY=... \
  -e SESSION_SECRET=... \
  amazon-hub-brain
```

The Dockerfile:
- Uses `node:20-alpine` base image
- Installs only production dependencies
- Runs the server via `npm start`
- Reads `PORT` from environment at runtime

### Environment-Specific Configs

**Production checklist:**

1. Set `NODE_ENV=production`
2. Use strong `SESSION_SECRET` (32+ random bytes)
3. Configure CORS `ALLOWED_ORIGINS` for your domain
4. Use HTTPS (terminate at load balancer)
5. Set up database backups
6. Configure monitoring/logging

### Recommended Infrastructure

- **Hosting**: AWS ECS, GCP Cloud Run, Railway, Render
- **Database**: Supabase, AWS RDS, GCP Cloud SQL
- **CDN**: CloudFlare, AWS CloudFront

## API Documentation

### Authentication

All endpoints (except `/auth/*`) require authentication via session cookie.

#### Login
```
POST /auth/login
Body: { email, password }
Response: { user: { id, email, name, role } }
```

#### Logout
```
POST /auth/logout
```

### Key Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/dashboard` | GET | Homepage data |
| `/orders` | GET | List orders |
| `/orders/import` | POST | Import from Shopify |
| `/pick-batches` | GET/POST | Manage pick batches |
| `/pick-batches/:id/reserve` | POST | Reserve stock |
| `/pick-batches/:id/confirm` | POST | Confirm dispatch |
| `/components` | GET/POST | Manage components |
| `/stock/receive` | POST | Receive stock |
| `/stock/adjust` | POST | Adjust stock |
| `/boms` | GET/POST | Manage BOMs |
| `/listings` | GET/POST | Manage listing memory |
| `/review` | GET | Review queue |
| `/review/:id/resolve` | POST | Resolve review item |
| `/returns` | GET/POST | Manage returns |
| `/brain/resolve` | POST | Resolve listing |
| `/brain/parse` | POST | Parse title |

### Idempotency

Irreversible operations require an `Idempotency-Key` header:

```bash
curl -X POST /stock/receive \
  -H "Idempotency-Key: unique-key-123" \
  -H "Content-Type: application/json" \
  -d '{"component_id": "...", "location": "Warehouse", "quantity": 10}'
```

## Monitoring

### Health Check

```bash
curl http://localhost:3001/health
```

### Logs

- All requests logged with correlation ID
- Format: `[correlation-id] METHOD /path STATUS duration`

### Metrics to Monitor

- Order import success rate
- Pick batch completion rate
- Stock levels vs thresholds
- Review queue depth
- API response times

## Troubleshooting

### Common Issues

**"Session not found" errors:**
- Check `SESSION_SECRET` is set
- Verify cookies are enabled (CORS credentials)

**Shopify import fails:**
- Verify `SHOPIFY_ACCESS_TOKEN` has `read_orders` scope
- Check store URL format (without `https://`)

**Database connection errors:**
- Verify `SUPABASE_URL` and keys
- Check network/firewall rules

**Stock operations fail:**
- Check RPC functions are deployed
- Verify component/location exists

### Support

For issues, check:
1. Server logs for correlation ID
2. Browser console for client errors
3. Database logs for query errors

## Security Considerations

1. **Authentication**: Session-based with secure cookies
2. **Authorization**: Role-based (ADMIN/STAFF)
3. **API**: Rate limiting recommended at load balancer
4. **Data**: All sensitive operations logged to audit table
5. **Secrets**: Never commit `.env` files

## Backup Strategy

### Database

```bash
# Full backup
pg_dump -h your-host -U postgres amazon_hub_brain > backup.sql

# Restore
psql -h your-host -U postgres amazon_hub_brain < backup.sql
```

### Recommended Schedule

- Full backup: Daily
- Transaction logs: Every 15 minutes
- Retention: 30 days minimum

## Updates and Migrations

1. Always backup before migrations
2. Run migrations in a transaction
3. Test in staging first
4. Keep migrations idempotent

```bash
# Apply new migration
psql -d amazon_hub_brain -f new_migration.sql
```

## License

Proprietary - Invicta Tools & Fixings Ltd
