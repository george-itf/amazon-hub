import rateLimit from 'express-rate-limit';

/**
 * Standard rate limiter for general API endpoints
 * 100 requests per 15 minutes per IP
 */
export const standardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  // Acknowledge that we're using 'trust proxy: 1' in index.js
  validate: { trustProxy: false },
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later'
    }
  }
});

/**
 * Heavy operation rate limiter for expensive endpoints
 * Used for analytics, search, and report generation
 * 100 requests per 15 minutes per IP (same as standard)
 */
export const heavyOpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  // Acknowledge that we're using 'trust proxy: 1' in index.js
  validate: { trustProxy: false },
  message: {
    success: false,
    error: {
      code: 'HEAVY_OP_RATE_LIMIT',
      message: 'Too many resource-intensive requests, please try again in an hour'
    }
  }
});

/**
 * Auth rate limiter for login/registration endpoints
 * 5 attempts per 15 minutes per IP
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful logins
  // Acknowledge that we're using 'trust proxy: 1' in index.js
  validate: { trustProxy: false },
  message: {
    success: false,
    error: {
      code: 'AUTH_RATE_LIMIT',
      message: 'Too many authentication attempts, please try again later'
    }
  }
});
