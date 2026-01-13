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

export default supabase;