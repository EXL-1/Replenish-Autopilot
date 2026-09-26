import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

/**
 * Server-side client. Service role BYPASSES RLS — every query must filter by
 * user_id explicitly. RLS is the guarantee for client-facing reads; this
 * client is the trusted path used by the order/audit writer.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('[supabase] missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  }

  _client = createClient(url, serviceKey, { auth: { persistSession: false } });
  return _client;
}

/**
 * Lazy proxy so importing this module never constructs a client at build time
 * (Next.js collects page data before env vars exist). First property access
 * constructs the real client.
 */
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabaseAdmin() as unknown as Record<string | symbol, unknown>;
    const value = client[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
