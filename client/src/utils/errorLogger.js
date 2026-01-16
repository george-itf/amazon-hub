/**
 * Safe error logging utility
 * Ensures errors are always logged with a defined message
 */

/**
 * Safely extract error message from various error types
 * @param {any} error - Error object, string, or other value
 * @returns {string} - Safe error message
 */
export function getErrorMessage(error) {
  if (!error) {
    return 'An unexpected error occurred';
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error) {
    return error.message || 'Unknown error';
  }

  if (typeof error === 'object') {
    // Try common error message properties
    if (error.message) return String(error.message);
    if (error.error) return String(error.error);
    if (error.msg) return String(error.msg);

    // Try to stringify if it's a plain object
    try {
      const str = JSON.stringify(error);
      if (str && str !== '{}') return str;
    } catch {
      // Ignore stringify errors
    }
  }

  // Fallback: try to convert to string
  try {
    return String(error);
  } catch {
    return 'Unknown error (could not stringify)';
  }
}

/**
 * Safe console.error wrapper
 * Ensures error messages are always defined
 * @param {string} context - Context string (e.g., "Failed to load data")
 * @param {any} error - Error to log
 */
export function logError(context, error) {
  const message = getErrorMessage(error);

  if (error instanceof Error && error.stack) {
    console.error(`${context}:`, message, '\n', error.stack);
  } else {
    console.error(`${context}:`, message);
  }
}

/**
 * Safe console.warn wrapper
 * @param {string} context - Context string
 * @param {any} message - Message to log
 */
export function logWarning(context, message) {
  const safeMessage = getErrorMessage(message);
  console.warn(`${context}:`, safeMessage);
}

/**
 * Create a safe error object with guaranteed message
 * @param {any} error - Original error
 * @param {string} defaultMessage - Default message if error has none
 * @returns {Error} - Error object with guaranteed message
 */
export function ensureError(error, defaultMessage = 'An error occurred') {
  if (error instanceof Error) {
    // Ensure message is defined
    if (!error.message) {
      error.message = defaultMessage;
    }
    return error;
  }

  // Create new Error with message
  const message = getErrorMessage(error);
  const newError = new Error(message || defaultMessage);

  // Preserve original error properties if it was an object
  if (error && typeof error === 'object') {
    Object.assign(newError, error);
  }

  return newError;
}

export default {
  getErrorMessage,
  logError,
  logWarning,
  ensureError,
};
