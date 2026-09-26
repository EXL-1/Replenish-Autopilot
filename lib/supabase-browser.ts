import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/**
 * Browser client. Uses the PUBLIC anon key and a real signed-in session, so every
 * query is subject to row-level security — the panel proves the privacy claims
 * rather than bypassing them with the service-role key.
 */
export function browserClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error('Supabase public env vars are missing');

  client = createClient(url, anon, { auth: { persistSession: false } });
  return client;
}
