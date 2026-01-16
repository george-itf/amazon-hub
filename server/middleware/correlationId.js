import { v4 as uuidv4 } from 'uuid';
import { ErrorCode, ErrorCategory } from '../types/errorCodes.js';

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
 * Map error codes to categories for client-side handling
 */
function getErrorCategory(code) {
  switch (code) {
    case ErrorCode.BAD_REQUEST:
    case ErrorCode.VALIDATION_ERROR:
    case ErrorCode.INVALID_STATUS:
      return ErrorCategory.VALIDATION;

    case ErrorCode.DUPLICATE_REQUEST:
    case ErrorCode.INSUFFICIENT_STOCK:
      return ErrorCategory.CONFLICT;

    case ErrorCode.ROYAL_MAIL_ERROR:
    case ErrorCode.EXTERNAL_API_ERROR:
      return ErrorCategory.EXTERNAL;

    case ErrorCode.INTERNAL_ERROR:
      return ErrorCategory.INTERNAL;

    case ErrorCode.INELIGIBLE_FOR_LABELING:
    case ErrorCode.BATCH_SIZE_EXCEEDED:
      return ErrorCategory.VALIDATION;

    default:
      return ErrorCategory.INTERNAL;
  }
}

/**
 * Standard API response helpers
 * All responses follow the contract:
 * Success: { ok: true, data: ..., correlation_id }
 * Error: { ok: false, error: { code, message, category, details? }, correlation_id }
 */
export function sendSuccess(res, data, statusCode = 200) {
  res.status(statusCode).json({
    ok: true,
    data,
    correlation_id: res.req.correlationId
  });
}

export function sendError(res, code, message, details = null, statusCode = 400, category = null) {
  const errorCategory = category || getErrorCategory(code);
  const error = {
    code,
    message,
    category: errorCategory
  };
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
    sendError(res, 'UNAUTHORIZED', message, null, 401, ErrorCategory.VALIDATION),

  forbidden: (res, message = 'Forbidden') =>
    sendError(res, 'FORBIDDEN', message, null, 403, ErrorCategory.VALIDATION),

  notFound: (res, resource = 'Resource') =>
    sendError(res, 'NOT_FOUND', `${resource} not found`, null, 404, ErrorCategory.VALIDATION),

  badRequest: (res, message, details = null) =>
    sendError(res, ErrorCode.BAD_REQUEST, message, details, 400, ErrorCategory.VALIDATION),

  conflict: (res, message, details = null) =>
    sendError(res, 'CONFLICT', message, details, 409, ErrorCategory.CONFLICT),

  internal: (res, message = 'Internal server error') =>
    sendError(res, ErrorCode.INTERNAL_ERROR, message, null, 500, ErrorCategory.INTERNAL),

  insufficientStock: (res, details) =>
    sendError(res, ErrorCode.INSUFFICIENT_STOCK, 'Insufficient stock available', details, 400, ErrorCategory.CONFLICT),

  invalidStatus: (res, message, details = null) =>
    sendError(res, ErrorCode.INVALID_STATUS, message, details, 400, ErrorCategory.VALIDATION),

  idempotencyConflict: (res) =>
    sendError(res, ErrorCode.DUPLICATE_REQUEST, 'Request with this idempotency key already processed', null, 409, ErrorCategory.CONFLICT),

  // Shipping-specific errors
  ineligibleForLabeling: (res, message, details = null) =>
    sendError(res, ErrorCode.INELIGIBLE_FOR_LABELING, message, details, 400, ErrorCategory.VALIDATION),

  batchSizeExceeded: (res, message, details = null) =>
    sendError(res, ErrorCode.BATCH_SIZE_EXCEEDED, message, details, 400, ErrorCategory.VALIDATION),

  royalMailError: (res, message, details = null) =>
    sendError(res, ErrorCode.ROYAL_MAIL_ERROR, message, details, 502, ErrorCategory.EXTERNAL),

  externalApiError: (res, message, details = null) =>
    sendError(res, ErrorCode.EXTERNAL_API_ERROR, message, details, 502, ErrorCategory.EXTERNAL),

  validationError: (res, message, details = null) =>
    sendError(res, ErrorCode.VALIDATION_ERROR, message, details, 400, ErrorCategory.VALIDATION)
};

// Re-export error codes and categories for convenience
export { ErrorCode, ErrorCategory };
