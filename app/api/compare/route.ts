import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireUser, isDenied } from '@/lib/auth';
import { compareShops, pickBestWithinCap, humaniseKey, type Shop } from '@/lib/tavily';

export const runtime = 'nodejs';

/** Fresh findings are reused inside this window — rate-limit insurance for the live demo. */
const CACHE_TTL_MIN = Number(process.env.PRICE_CACHE_TTL_MINUTES ?? 20);

type Finding = {
  shop_id: string;
  shop_name: string;
  price: number;
  currency: string;
  in_stock: boolean;
  evidence_url: string;
};

type CachedRow = {
  shop_id: string;
  price: number | string;
  currency: string;
  in_stock: boolean;
  evidence_url: string | null;
  shops: { name: string } | null;
};

function shapeCache(rows: CachedRow[]): Finding[] {
  return rows.map((r) => ({
    shop_id: r.shop_id,
    shop_name: r.shops?.name ?? 'unknown shop',
    price: Number(r.price),
    currency: r.currency,
    in_stock: r.in_stock,
    evidence_url: r.evidence_url ?? '',
  }));
}

/** Over-cap is never silent — it becomes an `escalate`, per CONTRACT.md §2. */
function verdict(findings: Finding[], cap: number | null) {
  if (findings.length === 0) return { decision: 'deny' as const, reason: 'no prices found' };

  const { pick, cheapest } = pickBestWithinCap(
    findings,
    cap ?? Number.POSITIVE_INFINITY,
  );

  if (!pick) {
    return {
      decision: 'escalate' as const,
      reason: `cheapest £${cheapest} exceeds cap £${cap}`,
      cheapest,
    };
  }
  return { decision: 'allow' as const, pick, cheapest };
}

/**
 * POST /api/compare
 * body: { consumable_id, max_amount?, refresh? }
 *
 * ReorderSignal -> Tavily across the configured shops -> price_findings rows.
 * Cached responses are served inside CACHE_TTL_MIN unless `refresh: true`.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    consumable_id?: string;
    max_amount?: number;
    refresh?: boolean;
  };

  const { consumable_id, max_amount, refresh } = body;
  if (!consumable_id) {
    return NextResponse.json({ error: 'consumable_id required' }, { status: 400 });
  }

  const caller = await requireUser(req);
  if (isDenied(caller)) {
    return NextResponse.json({ error: caller.error }, { status: caller.status });
  }

  const { data: consumable, error: cErr } = await supabaseAdmin
    .from('consumables')
    .select('*')
    .eq('id', consumable_id)
    .single();

  if (cErr || !consumable) {
    return NextResponse.json({ error: 'consumable not found' }, { status: 404 });
  }

  // The service-role client bypasses RLS, so ownership is checked here instead:
  // a consumable belonging to someone else must look identical to one that
  // doesn't exist, otherwise this endpoint enumerates other people's data.
  if (consumable.user_id !== caller.userId) {
    return NextResponse.json({ error: 'consumable not found' }, { status: 404 });
  }

  const cap = typeof max_amount === 'number' ? max_amount : null;
  const label = { id: consumable.id, product_key: consumable.product_key, query: humaniseKey(consumable.product_key) };

  // --- cache first ---
  if (!refresh) {
    const since = new Date(Date.now() - CACHE_TTL_MIN * 60_000).toISOString();
    const { data } = await supabaseAdmin
      .from('price_findings')
      .select('shop_id, price, currency, in_stock, evidence_url, shops(name)')
      .eq('consumable_id', consumable_id)
      .gte('found_at', since)
      .order('price', { ascending: true });

    const rows = (data ?? []) as unknown as CachedRow[];
    if (rows.length > 0) {
      const findings = shapeCache(rows);
      return NextResponse.json({ cached: true, consumable: label, findings, ...verdict(findings, cap) });
    }
  }

  const { data: shopRows } = await supabaseAdmin
    .from('shops')
    .select('*')
    .eq('user_id', consumable.user_id)
    .eq('scope', 'consumables');

  const shops = (shopRows ?? []) as Shop[];
  if (shops.length === 0) {
    return NextResponse.json({ error: 'no shops configured for this user' }, { status: 409 });
  }

  const findings = await compareShops(shops, consumable.product_key);

  if (findings.length > 0) {
    // Replace the previous comparison set, otherwise the cache serves a mix of runs
    // (old rows + new rows) and the panel shows duplicate shops.
    await supabaseAdmin.from('price_findings').delete().eq('consumable_id', consumable_id);

    const { error: iErr } = await supabaseAdmin.from('price_findings').insert(
      findings.map((f) => ({
        consumable_id,
        shop_id: f.shop_id,
        price: f.price,
        currency: f.currency,
        in_stock: f.in_stock,
        evidence_url: f.evidence_url,
      })),
    );
    if (iErr) console.warn('[compare] price_findings insert failed:', iErr.message);
  }

  const result = verdict(findings, cap);

  // Explainability: this is the row the privacy panel renders.
  await supabaseAdmin.from('audit_log').insert({
    user_id: consumable.user_id,
    action: 'compare',
    inputs: { consumable_id, product_key: consumable.product_key, max_amount: cap },
    options: findings.map((f) => ({ shop: f.shop_name, price: f.price, evidence_url: f.evidence_url })),
    choice: result.decision,
    reason:
      result.decision === 'allow'
        ? `cheapest within cap: £${'cheapest' in result ? result.cheapest : ''} at ${result.pick?.shop_name}`
        : result.reason,
  });

  return NextResponse.json({ cached: false, consumable: label, findings, ...result });
}
