import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Load environment variables from .env
dotenv.config();

// Middleware imports
import { correlationIdMiddleware, sendSuccess, errors } from './middleware/correlationId.js';
import { authMiddleware, requireAdmin, requireStaff } from './middleware/auth.js';
import { idempotencyMiddleware } from './middleware/idempotency.js';

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

// Create the Express app
const app = express();

// Trust proxy for correct IP detection behind load balancers
app.set('trust proxy', true);

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000', 'http://localhost:5173'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Parse JSON request bodies
app.use(express.json({ limit: '10mb' }));

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

// Auth routes (no auth middleware)
app.use('/auth', authRoutes);

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

// 404 handler
app.use((req, res) => {
  errors.notFound(res, 'Endpoint');
});

// Error handler
app.use((err, req, res, next) => {
  console.error(`[${req.correlationId}] Error:`, err);

  if (err.message === 'Not allowed by CORS') {
    return errors.forbidden(res, 'CORS policy does not allow this origin');
  }

  errors.internal(res, process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message);
});

// Start listening for incoming requests
const port = process.env.PORT || 3001;
const server = app.listen(port, () => {
  console.log(`Amazon Hub Brain API listening on port ${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export default app;
