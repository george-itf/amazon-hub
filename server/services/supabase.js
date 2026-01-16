import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables so they are available here when imported
dotenv.config();

// Use the service role key so the backend can bypass RLS policies.
// In production you must protect this key and never expose it to the
// frontend.  Only server‑side code may use it.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Supabase URL or service role key is missing.  Check your environment variables.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false
  }
});

/**
 * Fetch all rows from a table by paginating through results
 * Supabase has a default limit of 1000 rows - this fetches all by paginating
 *
 * @param {string} table - Table name
 * @param {string} select - Select query string
 * @param {Object} options - Query options
 * @returns {Promise<{data: Array, count: number, error: any}>}
 */
export async function fetchAllRows(table, select = '*', options = {}) {
  const pageSize = 1000;
  let allData = [];
  let offset = 0;
  let totalCount = 0;
  let error = null;

  try {
    // First get count
    const { count, error: countError } = await supabase
      .from(table)
      .select(select, { count: 'exact', head: true });

    if (countError) {
      return { data: [], count: 0, error: countError };
    }

    totalCount = count || 0;

    // Fetch in batches
    while (offset < totalCount) {
      let query = supabase
        .from(table)
        .select(select)
        .range(offset, offset + pageSize - 1);

      // Apply filters
      if (options.eq) {
        for (const [col, val] of Object.entries(options.eq)) {
          query = query.eq(col, val);
        }
      }
      if (options.order) {
        query = query.order(options.order.column, { ascending: options.order.ascending ?? true });
      }

      const { data, error: fetchError } = await query;

      if (fetchError) {
        error = fetchError;
        break;
      }

      allData = allData.concat(data || []);
      offset += pageSize;

      // Safety break if no data returned
      if (!data || data.length === 0) break;
    }

    return { data: allData, count: totalCount, error };
  } catch (err) {
    return { data: [], count: 0, error: err };
  }
}

export default supabase;