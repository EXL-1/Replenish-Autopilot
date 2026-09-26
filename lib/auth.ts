import { supabaseAdmin } from './supabase';

export type Caller = { userId: string };
export type Denied = { error: string; status: number };

/**
 * Verify the caller's Supabase JWT.
 *
 * Every route in this app talks to Postgres through the service-role key, which
 * BYPASSES row-level security. That means the RLS policies protecting the panel
 * give these routes no protection at all — the JWT check below is the only thing
 * standing between a stranger and someone else's data.
 *
 * Call this first in any route that reads or writes user data, then scope every
 * query to the returned userId. Never trust a user_id from the body or query string.
 */
export async function requireUser(req: Request): Promise<Caller | Denied> {
  const header = req.headers.get('authorization') ?? '';
  const jwt = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!jwt) {
    return { error: 'missing bearer token', status: 401 };
  }

  const { data, error } = await supabaseAdmin.auth.getUser(jwt);
  if (error || !data?.user) {
    return { error: 'invalid or expired token', status: 401 };
  }

  return { userId: data.user.id };
}

/** Narrowing helper so routes read cleanly: `if (isDenied(caller)) return ...` */
export function isDenied(c: Caller | Denied): c is Denied {
  return 'error' in c;
}
