import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Load environment variables from .env
dotenv.config();

// Middleware imports
import { correlationIdMiddleware, sendSuccess, errors } from './middleware/correlationId.js';
import { authMiddleware, requireAdmin, requireStaff } from './middleware/auth.js';
import { idempotencyMiddleware } from './middleware/idempotency.js';
import { standardLimiter, heavyOpLimiter, authLimiter } from './middleware/rateLimit.js';

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
import scheduler from './services/scheduler.js';

// Create the Express app
const app = express();

// Trust proxy for correct IP detection behind load balancers
// Use '1' to trust only one proxy hop (Railway/Vercel load balancer)
app.set('trust proxy', 1);

// First-line request debug logging (before any middleware)
app.use((req, res, next) => {
  console.log(`[DEBUG] Incoming request: ${req.method} ${req.url} from ${req.ip}`);
  next();
});

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
