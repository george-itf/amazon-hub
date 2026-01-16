/**
 * Pagination Utilities
 *
 * Consistent pagination helpers for server routes.
 * Supports both offset-based and cursor-based pagination.
 */

/**
 * Parse pagination parameters from request query
 *
 * @param {Object} query - Request query object
 * @param {Object} defaults - Default values
 * @returns {Object} - Parsed pagination params
 */
export function parsePagination(query, defaults = {}) {
  const {
    limit: defaultLimit = 50,
    maxLimit = 500,
    defaultOffset = 0,
  } = defaults;

  const limit = Math.min(
    Math.max(1, parseInt(query.limit) || defaultLimit),
    maxLimit
  );

  const offset = Math.max(0, parseInt(query.offset) || defaultOffset);

  // Calculate page number for convenience
  const page = Math.floor(offset / limit) + 1;

  return {
    limit,
    offset,
    page,
    // Range for Supabase .range() method
    rangeStart: offset,
    rangeEnd: offset + limit - 1,
  };
}

/**
 * Build pagination response metadata
 *
 * @param {Object} params - Pagination parameters
 * @param {number} totalCount - Total count of items
 * @returns {Object} - Pagination metadata for response
 */
export function buildPaginationMeta(params, totalCount) {
  const { limit, offset } = params;
  const totalPages = Math.ceil(totalCount / limit);
  const currentPage = Math.floor(offset / limit) + 1;
  const hasNextPage = offset + limit < totalCount;
  const hasPrevPage = offset > 0;

  return {
    total: totalCount,
    limit,
    offset,
    page: currentPage,
    totalPages,
    hasNextPage,
    hasPrevPage,
    // Convenience URLs for next/prev (relative)
    nextOffset: hasNextPage ? offset + limit : null,
    prevOffset: hasPrevPage ? Math.max(0, offset - limit) : null,
  };
}

/**
 * Apply pagination to a Supabase query
 *
 * @param {Object} query - Supabase query builder
 * @param {Object} params - Parsed pagination params
 * @returns {Object} - Query with range applied
 */
export function applyPagination(query, params) {
  return query.range(params.rangeStart, params.rangeEnd);
}

/**
 * Cursor-based pagination - more efficient for large datasets
 *
 * @param {Object} query - Request query object
 * @param {Object} options - Cursor pagination options
 * @returns {Object} - Parsed cursor pagination params
 */
export function parseCursorPagination(query, options = {}) {
  const {
    limit: defaultLimit = 50,
    maxLimit = 200,
    cursorField = 'id',
    direction = 'after',
  } = options;

  const limit = Math.min(
    Math.max(1, parseInt(query.limit) || defaultLimit),
    maxLimit
  );

  // Cursor is the value to paginate from (e.g., last seen ID)
  const cursor = query.cursor || null;
  const cursorDirection = query.direction || direction;

  return {
    limit,
    cursor,
    cursorDirection,
    cursorField,
    // Add 1 to check if there are more results
    fetchLimit: limit + 1,
  };
}

/**
 * Build cursor pagination response
 *
 * @param {Array} data - Fetched data (with extra item for hasMore check)
 * @param {Object} params - Cursor pagination params
 * @param {Function} getCursor - Function to extract cursor value from item
 * @returns {Object} - Data with cursor pagination metadata
 */
export function buildCursorResponse(data, params, getCursor) {
  const { limit, cursorField } = params;
  const hasMore = data.length > limit;

  // Remove the extra item we fetched for hasMore check
  const items = hasMore ? data.slice(0, limit) : data;

  // Get cursors for next/prev navigation
  const nextCursor = hasMore && items.length > 0
    ? getCursor(items[items.length - 1])
    : null;

  const prevCursor = items.length > 0
    ? getCursor(items[0])
    : null;

  return {
    items,
    pagination: {
      limit,
      hasMore,
      nextCursor,
      prevCursor,
      cursorField,
    },
  };
}

/**
 * Helper to validate sort parameters
 *
 * @param {string} sortBy - Requested sort field
 * @param {Array<string>} allowedFields - List of allowed sort fields
 * @param {string} defaultField - Default sort field
 * @returns {Object} - Validated sort configuration
 */
export function parseSort(sortBy, allowedFields, defaultField) {
  // Parse sort direction (e.g., "-created_at" for descending)
  const isDescending = sortBy?.startsWith('-');
  const field = isDescending ? sortBy.slice(1) : (sortBy || defaultField);

  // Validate field is allowed
  const validField = allowedFields.includes(field) ? field : defaultField;

  return {
    field: validField,
    ascending: !isDescending,
    supabaseOrder: { ascending: !isDescending },
  };
}

export default {
  parsePagination,
  buildPaginationMeta,
  applyPagination,
  parseCursorPagination,
  buildCursorResponse,
  parseSort,
};
