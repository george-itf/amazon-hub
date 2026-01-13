/**
 * Input validation utilities for API endpoints
 */

/**
 * Validate and sanitize pagination parameters
 * @param {Object} query - Express req.query object
 * @param {Object} options - Configuration options
 * @returns {Object} Sanitized { limit, offset }
 */
export function validatePagination(query, options = {}) {
  const {
    defaultLimit = 50,
    maxLimit = 1000,
    minLimit = 1
  } = options;

  let limit = parseInt(query.limit, 10);
  let offset = parseInt(query.offset, 10);

  // Handle NaN and invalid values
  if (isNaN(limit) || limit < minLimit) {
    limit = defaultLimit;
  } else if (limit > maxLimit) {
    limit = maxLimit;
  }

  if (isNaN(offset) || offset < 0) {
    offset = 0;
  }

  return { limit, offset };
}

/**
 * Validate UUID format
 * @param {string} id - The ID to validate
 * @returns {boolean} True if valid UUID
 */
export function isValidUUID(id) {
  if (!id || typeof id !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

/**
 * Validate string field
 * @param {string} value - Value to validate
 * @param {Object} options - Validation options
 * @returns {Object} { valid: boolean, error: string|null, value: string }
 */
export function validateString(value, options = {}) {
  const {
    required = false,
    minLength = 0,
    maxLength = 1000,
    fieldName = 'Field'
  } = options;

  if (value === undefined || value === null || value === '') {
    if (required) {
      return { valid: false, error: `${fieldName} is required`, value: null };
    }
    return { valid: true, error: null, value: null };
  }

  if (typeof value !== 'string') {
    return { valid: false, error: `${fieldName} must be a string`, value: null };
  }

  const trimmed = value.trim();

  if (trimmed.length < minLength) {
    return { valid: false, error: `${fieldName} must be at least ${minLength} characters`, value: null };
  }

  if (trimmed.length > maxLength) {
    return { valid: false, error: `${fieldName} must not exceed ${maxLength} characters`, value: null };
  }

  return { valid: true, error: null, value: trimmed };
}

/**
 * Validate positive integer
 * @param {any} value - Value to validate
 * @param {Object} options - Validation options
 * @returns {Object} { valid: boolean, error: string|null, value: number }
 */
export function validatePositiveInt(value, options = {}) {
  const {
    required = false,
    min = 1,
    max = Number.MAX_SAFE_INTEGER,
    fieldName = 'Field'
  } = options;

  if (value === undefined || value === null || value === '') {
    if (required) {
      return { valid: false, error: `${fieldName} is required`, value: null };
    }
    return { valid: true, error: null, value: null };
  }

  const num = parseInt(value, 10);

  if (isNaN(num)) {
    return { valid: false, error: `${fieldName} must be a number`, value: null };
  }

  if (num < min) {
    return { valid: false, error: `${fieldName} must be at least ${min}`, value: null };
  }

  if (num > max) {
    return { valid: false, error: `${fieldName} must not exceed ${max}`, value: null };
  }

  return { valid: true, error: null, value: num };
}

/**
 * Validate enum value
 * @param {any} value - Value to validate
 * @param {Array} allowedValues - Array of allowed values
 * @param {Object} options - Validation options
 * @returns {Object} { valid: boolean, error: string|null, value: any }
 */
export function validateEnum(value, allowedValues, options = {}) {
  const {
    required = false,
    fieldName = 'Field'
  } = options;

  if (value === undefined || value === null || value === '') {
    if (required) {
      return { valid: false, error: `${fieldName} is required`, value: null };
    }
    return { valid: true, error: null, value: null };
  }

  if (!allowedValues.includes(value)) {
    return {
      valid: false,
      error: `${fieldName} must be one of: ${allowedValues.join(', ')}`,
      value: null
    };
  }

  return { valid: true, error: null, value };
}

export default {
  validatePagination,
  isValidUUID,
  validateString,
  validatePositiveInt,
  validateEnum
};
