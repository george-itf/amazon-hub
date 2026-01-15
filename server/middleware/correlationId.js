import { v4 as uuidv4 } from 'uuid';

/**
 * Correlation ID middleware
 * Generates a unique correlation ID for each request and attaches it to the request object.
 * The correlation ID is included in all responses and logs for traceability.
 */
export function correlationIdMiddleware(req, res, next) {
  // Use existing correlation ID from header or generate new one
  const correlationId = req.headers['x-correlation-id'] || uuidv4();

  req.correlationId = correlationId;

  // Add to response headers
  res.setHeader('X-Correlation-ID', correlationId);

  next();
}

/**
 * Standard API response helpers
 * All responses follow the contract:
 * Success: { ok: true, data: ... }
 * Error: { ok: false, error: { code, message, details? }, correlation_id }
 */
export function sendSuccess(res, data, statusCode = 200) {
  res.status(statusCode).json({
    ok: true,
    data,
    correlation_id: res.req.correlationId
  });
}

export function sendError(res, code, message, details = null, statusCode = 400) {
  const error = { code, message };
  if (details) {
    error.details = details;
  }

  res.status(statusCode).json({
    ok: false,
    error,
    correlation_id: res.req.correlationId
  });
}

// Common error responses
export const errors = {
  unauthorized: (res, message = 'Unauthorized') =>
    sendError(res, 'UNAUTHORIZED', message, null, 401),

  forbidden: (res, message = 'Forbidden') =>
    sendError(res, 'FORBIDDEN', message, null, 403),

  notFound: (res, resource = 'Resource') =>
    sendError(res, 'NOT_FOUND', `${resource} not found`, null, 404),

  badRequest: (res, message, details = null) =>
    sendError(res, 'BAD_REQUEST', message, details, 400),

  conflict: (res, message, details = null) =>
    sendError(res, 'CONFLICT', message, details, 409),

  internal: (res, message = 'Internal server error') =>
    sendError(res, 'INTERNAL_ERROR', message, null, 500),

  insufficientStock: (res, details) =>
    sendError(res, 'INSUFFICIENT_STOCK', 'Insufficient stock available', details, 400),

  invalidStatus: (res, message, details = null) =>
    sendError(res, 'INVALID_STATUS', message, details, 400),

  idempotencyConflict: (res) =>
    sendError(res, 'IDEMPOTENCY_CONFLICT', 'Request with this idempotency key already processed', null, 409)
};
