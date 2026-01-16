import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from .env
dotenv.config();

// ============================================================================
// JWT_SECRET VALIDATION: Ensure JWT_SECRET is properly configured
// ============================================================================
const PLACEHOLDER_SECRETS = [
  'change-this-secret',
  'your-secret-here',
  'secret',
  'jwt-secret',
  'your_jwt_secret',
  'changeme',
  'replace-me',
  'placeholder',
];

const jwtSecret = process.env.JWT_SECRET;
const isProduction = process.env.NODE_ENV === 'production';
const isPlaceholder = !jwtSecret || PLACEHOLDER_SECRETS.includes(jwtSecret.toLowerCase());

if (isPlaceholder) {
  if (isProduction) {
    console.error('========================================');
    console.error('[FATAL] JWT_SECRET is missing or set to a placeholder value.');
    console.error('In production, you MUST set a secure, unique JWT_SECRET.');
    console.error('Server cannot start with an insecure JWT configuration.');
    console.error('========================================');
    process.exit(1);
  } else {
    console.warn('========================================');
    console.warn('[WARNING] JWT_SECRET is missing or set to a placeholder value.');
    console.warn('This is acceptable for development, but MUST be changed in production.');
    console.warn('Set a secure, unique JWT_SECRET environment variable.');
    console.warn('========================================');
  }
}

// Get __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// QUARANTINE CHECK: Warn about deprecated files that are still being loaded
// If any deprecated files are accidentally imported, this will alert us
// ============================================================================
const deprecatedDir = path.join(__dirname, '_deprecated');
if (fs.existsSync(deprecatedDir)) {
  const deprecatedFiles = fs.readdirSync(deprecatedDir).filter(f => f.endsWith('.js'));
  if (deprecatedFiles.length > 0) {
    console.warn('========================================');
    console.warn('[QUARANTINE] Deprecated files detected:');
    deprecatedFiles.forEach(file => {
      console.warn(`  - _deprecated/${file}`);
    });
    console.warn('These files are in quarantine. If no errors occur,');
    console.warn('they can be safely deleted after the observation period.');
    console.warn('See _deprecated/README.md for details.');
    console.warn('========================================');
  }
}

// Middleware imports
import { correlationIdMiddleware, sendSuccess, errors } from './middleware/correlationId.js';
import { authMiddleware, requireAdmin, requireStaff } from './middleware/auth.js';
import { idempotencyMiddleware } from './middleware/idempotency.js';
import { standardLimiter, heavyOpLimiter, authLimiter } from './middleware/rateLimit.js';

// Service imports (for public endpoints)
import supabase from './services/supabase.js';

// Route imports
import authRoutes from './routes/auth.js';
import componentsRoutes from './routes/components.js';
import bomsRoutes from './routes/boms.js';
import listingsRoutes from './routes/listings.js';
import ordersRoutes from './routes/orders.js';
import pickBatchesRoutes from './routes/pickBatches.js';
import stockRoutes from './routes/stock.js';
import returnsRoutes from './routes/returns.js';
import reviewRoutes from './routes/review.js';
import keepaRoutes from './routes/keepa.js';
import intelligenceRoutes from './routes/intelligence.js';
import auditRoutes from './routes/audit.js';
import dashboardRoutes from './routes/dashboard.js';
import brainRoutes from './routes/brain.js';
import analyticsRoutes from './routes/analytics.js';
import profitRoutes from './routes/profit.js';
import amazonRoutes from './routes/amazon.js';
import shippingRoutes from './routes/shipping.js';
import inventoryRoutes from './routes/inventory.js';
import viewsRoutes from './routes/views.js';
import listingSettingsRoutes from './routes/listingSettings.js';
import asinAnalyzerRoutes from './routes/asinAnalyzer.js';
import healthRoutes from './routes/health.js';
import preferencesRoutes from './routes/preferences.js';
import scheduler from './services/scheduler.js';

// Create the Express app
const app = express();

// Trust proxy for correct IP detection behind load balancers
// Use '1' to trust only one proxy hop (Railway/Vercel load balancer)
app.set('trust proxy', 1);

// First-line request debug logging (before any middleware)
// Only enable in non-production environments to prevent log spam and information leakage
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`[DEBUG] Incoming request: ${req.method} ${req.url} from ${req.ip}`);
    next();
  });
}

// CORS configuration - trim whitespace from origins
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000', 'http://localhost:5173'];

// Vercel preview URL pattern for the project (harbourgate team)
const vercelPreviewPattern = /^https:\/\/amazon-[a-z0-9]+-harbourgate\.vercel\.app$/;

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    // Check explicit allowed origins
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Allow Vercel preview deployments for harbourgate project
    if (vercelPreviewPattern.test(origin)) {
      return callback(null, true);
    }

    console.warn(`CORS blocked origin: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// Security headers (apply in all environments for consistency)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0'); // Deprecated, disable in favor of CSP
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // Content Security Policy - no unsafe-inline for better XSS protection
  // React/Vite bundles all scripts externally, so inline scripts are not needed
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'"
  ].join('; '));

  // HSTS only in production (requires HTTPS)
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
});

// Parse JSON request bodies (5MB limit for production safety)
app.use(express.json({ limit: '5mb' }));

// Correlation ID middleware - adds unique ID to every request
app.use(correlationIdMiddleware);

// Request logging (minimal)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (process.env.NODE_ENV !== 'test') {
      console.log(`[${req.correlationId}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    }
  });
  next();
});

// Ultra-simple ping endpoint for debugging (bypasses all helpers)
app.get('/ping', (req, res) => {
  res.status(200).json({ pong: true, time: Date.now() });
});

// Health check endpoint (no auth required)
app.get('/health', (req, res) => {
  sendSuccess(res, {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  sendSuccess(res, {
    name: 'Amazon Hub Brain API',
    version: '1.0.0',
    status: 'running'
  });
});

// Auth routes (no auth middleware, rate limited)
app.use('/auth', authLimiter, authRoutes);

// Public Keepa status endpoint (no auth required for monitoring/diagnostics)
// Mounted before auth middleware so it's accessible without a token
app.get('/keepa/status', async (req, res) => {
  try {
    const { getKeepaSettings, getCacheStats } = await import('./services/keepaService.js');

    const settings = await getKeepaSettings();

    // Get tokens spent
    const { data: hourData } = await supabase
      .from('keepa_request_log')
      .select('tokens_spent')
      .gte('requested_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
      .eq('status', 'SUCCESS');

    const { data: dayData } = await supabase
      .from('keepa_request_log')
      .select('tokens_spent')
      .gte('requested_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .eq('status', 'SUCCESS');

    const tokensSpentHour = (hourData || []).reduce((sum, r) => sum + (r.tokens_spent || 0), 0);
    const tokensSpentDay = (dayData || []).reduce((sum, r) => sum + (r.tokens_spent || 0), 0);

    // Get cache stats
    const { count: cacheCount } = await supabase
      .from('keepa_products_cache')
      .select('*', { count: 'exact', head: true });

    const { count: staleCount } = await supabase
      .from('keepa_products_cache')
      .select('*', { count: 'exact', head: true })
      .lt('expires_at', new Date().toISOString());

    // Get latest account balance
    const { data: latestBalance } = await supabase
      .from('keepa_account_balance')
      .select('*')
      .order('recorded_at', { ascending: false })
      .limit(1);

    const accountBalance = latestBalance?.[0] || null;
    const cacheHitStats = getCacheStats();

    sendSuccess(res, {
      configured: !!process.env.KEEPA_API_KEY,
      domain_id: settings.domain_id,
      budget: {
        max_tokens_per_hour: settings.max_tokens_per_hour,
        max_tokens_per_day: settings.max_tokens_per_day,
        min_reserve: settings.min_reserve,
        tokens_spent_hour: tokensSpentHour,
        tokens_spent_day: tokensSpentDay,
        tokens_remaining_hour: settings.max_tokens_per_hour - tokensSpentHour,
        tokens_remaining_day: settings.max_tokens_per_day - tokensSpentDay
      },
      account: accountBalance ? {
        tokens_left: accountBalance.tokens_left,
        refill_rate: accountBalance.refill_rate,
        last_updated: accountBalance.recorded_at,
      } : null,
      cache: {
        total_products: cacheCount || 0,
        stale_products: staleCount || 0,
        min_refresh_minutes: settings.min_refresh_minutes,
        session_hit_rate: cacheHitStats.hitRate,
      },
    });
  } catch (err) {
    console.error('Keepa status error:', err);
    sendSuccess(res, {
      configured: !!process.env.KEEPA_API_KEY,
      error: 'Failed to fetch detailed status',
      message: err.message
    });
  }
});

// Apply authentication middleware to all subsequent routes
app.use(authMiddleware);

// Apply idempotency middleware (checks Idempotency-Key header)
app.use(idempotencyMiddleware());

// Dashboard/Home routes
app.use('/dashboard', dashboardRoutes);

// Components routes (stock management)
app.use('/components', componentsRoutes);

// BOMs routes
app.use('/boms', bomsRoutes);

// Listings/Memory routes
app.use('/listings', listingsRoutes);

// Orders routes
app.use('/orders', ordersRoutes);

// Pick batches routes
app.use('/pick-batches', pickBatchesRoutes);

// Stock routes (receive/adjust)
app.use('/stock', stockRoutes);

// Returns routes
app.use('/returns', returnsRoutes);

// Review queue routes
app.use('/review', reviewRoutes);

// Keepa routes
app.use('/keepa', keepaRoutes);

// Intelligence routes (constraints, bottlenecks)
app.use('/intelligence', intelligenceRoutes);

// Audit routes (timeline, logs)
app.use('/audit', auditRoutes);

// Brain routes (resolution, parsing)
app.use('/brain', brainRoutes);

// Analytics routes (profitability, trends) - heavy operation rate limited
app.use('/analytics', heavyOpLimiter, analyticsRoutes);

// Profit analyzer
app.use('/profit', profitRoutes);

// Amazon SP-API integration
app.use('/amazon', amazonRoutes);

// Shipping routes (Royal Mail Click & Drop)
app.use('/shipping', shippingRoutes);

// Inventory routes (pool allocation, recommendations)
app.use('/inventory', inventoryRoutes);

// UI Views routes (saved filter views)
app.use('/views', viewsRoutes);

// Listing Settings routes (per-listing overrides)
app.use('/listing-settings', listingSettingsRoutes);

// ASIN Analyzer routes (multi-ASIN analysis, BOM suggestions, reverse search)
app.use('/asin', asinAnalyzerRoutes);

// System Health routes (integration status, sync history)
app.use('/health', healthRoutes);

// User Preferences routes (cross-device sync)
app.use('/preferences', preferencesRoutes);

// 404 handler
app.use((req, res) => {
  errors.notFound(res, 'Endpoint');
});

// Error handler - always return generic message to prevent information leakage
app.use((err, req, res, next) => {
  // Log full error details server-side with correlation ID
  console.error(`[${req.correlationId || 'NO_CORRELATION_ID'}] ${req.method} ${req.path} Error:`, err.message);
  if (process.env.NODE_ENV !== 'production') {
    console.error(err.stack);
  }

  if (err.message === 'Not allowed by CORS') {
    return errors.forbidden(res, 'CORS policy does not allow this origin');
  }

  // Always return generic message - never expose internal error details
  return errors.internal(res, 'Internal server error');
});

// Start listening for incoming requests
const port = process.env.PORT || 3001;
const host = '0.0.0.0'; // Bind to all interfaces for container environments
const server = app.listen(port, host, () => {
  console.log(`Amazon Hub Brain API listening on ${host}:${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

  // Initialize scheduler after server is ready
  scheduler.init().catch(err => {
    console.error('Failed to initialize scheduler:', err);
  });
});

// Server timeout configuration to prevent idle connection DoS
server.headersTimeout = 30000;  // 30s to receive HTTP headers
server.requestTimeout = 60000; // 60s total request timeout
server.keepAliveTimeout = 5000; // 5s keep-alive before closing idle connections

// Graceful shutdown with timeout
const SHUTDOWN_TIMEOUT = 30000; // 30 seconds

function gracefulShutdown(signal) {
  console.log(`${signal} received, shutting down gracefully...`);

  // Set hard timeout to force exit if graceful shutdown hangs
  const shutdownTimer = setTimeout(() => {
    console.error('Forced shutdown due to timeout');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT);

  // Prevent the timeout from keeping the process alive
  shutdownTimer.unref();

  server.close(() => {
    console.log('All connections closed, server shutdown complete');
    clearTimeout(shutdownTimer);
    process.exit(0);
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
