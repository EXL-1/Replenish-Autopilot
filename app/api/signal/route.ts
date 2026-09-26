import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireUser, isDenied } from '@/lib/auth';
import type { ReorderSignal } from '@/lib/types';

export const runtime = 'nodejs';

const THRESHOLD_DAYS = Number(process.env.SIGNAL_THRESHOLD_DAYS ?? 7);

/**
 * GET /api/signal?user_id=...
 * Computes days-until-empty for each consumable and emits a ReorderSignal for
 * anything below the threshold. Gabriel owns the richer scheduler; this is the
 * trust-layer stub that proves the contract shape is wired end to end.
 */
export async function GET(req: Request) {
  const caller = await requireUser(req);
  if (isDenied(caller)) {
    return NextResponse.json({ error: caller.error }, { status: caller.status });
  }

  // Scoped to the authenticated user. A user_id in the query string is honoured
  // only when it matches the token — it is never trusted on its own.
  const requested = new URL(req.url).searchParams.get('user_id');
  if (requested && requested !== caller.userId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const userId = caller.userId;

  const { data: consumables, error } = await supabaseAdmin
    .from('consumables')
    .select('*')
    .eq('user_id', userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const today = Date.now();
  const signals: ReorderSignal[] = (consumables ?? [])
    .map((c) => {
      const days = Math.ceil((new Date(c.est_empty_date).getTime() - today) / 86_400_000);
      return {
        consumable_id: c.id,
        product_key: c.product_key,
        est_empty_date: c.est_empty_date,
        days_until_empty: days,
        source: (c.source as ReorderSignal['source']) ?? 'csv_seed',
      };
    })
    .filter((s) => s.days_until_empty <= THRESHOLD_DAYS);

  return NextResponse.json({ signals });
}
