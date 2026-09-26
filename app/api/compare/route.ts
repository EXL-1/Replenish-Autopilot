import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireUser, isDenied } from '@/lib/auth';
import { compareShops, pickBestWithinCap, humaniseKey, type Shop } from '@/lib/tavily';
import { checkToken } from '@/lib/policy-engine';
import { reasonAboutPick } from '@/lib/grok';
import type { SpendToken } from '@/lib/types';

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

type ConsumableRow = {
  id: string;
  user_id: string;
  product_key: string;
  est_empty_date: string | null;
  source: string | null;
};

/**
 * Explain this decision and write the row the privacy panel renders.
 *
 * Called on BOTH the cached and freshly-compared paths: a cache hit is still a
 * decision, and skipping the audit row there would leave a hole in the trail
 * exactly when a demo runs twice inside the price cache window.
 *
 * Grok writes the sentence; it does not make the call. Its suggested shop is put
 * through checkToken before anything is willing to act on it, and `deny` /
 * `escalate` still never reach placeOrder.
 */
async function explainAndLog(args: {
  consumable: ConsumableRow;
  findings: Finding[];
  cap: number | null;
  decision: 'allow' | 'deny' | 'escalate';
  pick?: { shop_name: string; price: number } | null;
  cheapest?: number | null;
  denyReason?: string;
}): Promise<{ why: string; source: 'grok' | 'fallback' }> {
  const { consumable, findings, cap, decision } = args;
  const templateWhy =
    decision === 'allow'
      ? `cheapest within cap: £${args.cheapest ?? ''} at ${args.pick?.shop_name}`
      : (args.denyReason ?? 'no decision');

  // The mandate that will govern the order. Grok gets its constraints — never the
  // Shopify admin token, never the service-role key, never a tool.
  const { data: tokenRow } = await supabaseAdmin
    .from('spend_tokens')
    .select('*')
    .eq('user_id', consumable.user_id)
    .eq('status', 'active')
    .order('issued_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const token = tokenRow as SpendToken | null;

  let shopName = 'the shop this mandate allows';
  if (token) {
    const { data: shop } = await supabaseAdmin
      .from('shops')
      .select('name')
      .eq('id', token.shop_id)
      .maybeSingle();
    if (shop?.name) shopName = String(shop.name);
  }

  const days = consumable.est_empty_date
    ? Math.ceil((new Date(consumable.est_empty_date).getTime() - Date.now()) / 86_400_000)
    : 0;

  const reason = await reasonAboutPick(
    {
      product_key: consumable.product_key,
      days_until_empty: days,
      source: consumable.source ?? 'csv_seed',
    },
    findings.map((f) => ({ shop: f.shop_name, price: f.price, evidence_url: f.evidence_url })),
    {
      shop: shopName,
      cap: Number(token?.max_amount ?? cap ?? 0),
      category: token?.category_scope ?? 'consumables',
      expires_on: token?.expires_at ? String(token.expires_at).slice(0, 10) : 'unknown',
    },
    templateWhy,
  );

  // If Grok named a shop, keep the policy engine as the authority on it. Its pick
  // is recorded, never obeyed.
  let suggestion: { shop: string; decision: string; reason: string } | null = null;
  if (token && args.pick) {
    const verdictOnPick = checkToken(token, {
      amount: args.pick.price,
      category: token.category_scope,
      shop_id: token.shop_id,
    });
    suggestion = {
      shop: args.pick.shop_name,
      decision: verdictOnPick.decision,
      reason: 'reason' in verdictOnPick ? verdictOnPick.reason : 'allowed',
    };
  }

  await supabaseAdmin.from('audit_log').insert({
    user_id: consumable.user_id,
    action: 'compare',
    inputs: {
      consumable_id: consumable.id,
      product_key: consumable.product_key,
      max_amount: cap,
      explained_by: reason.source, // 'grok' when the model answered, 'explicit_rule' when it didn't
    },
    options: findings.map((f) => ({ shop: f.shop_name, price: f.price, evidence_url: f.evidence_url })),
    choice: decision,
    reason: reason.why,
  });

  if (suggestion) console.log('[compare] policy verdict on the suggested pick:', suggestion);

  return reason;
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
      const result = verdict(findings, cap);
      // A cache hit is still a decision — log it, or the trail has a hole.
      const reason = await explainAndLog({
        consumable: consumable as ConsumableRow,
        findings,
        cap,
        decision: result.decision,
        pick: 'pick' in result ? result.pick : null,
        cheapest: 'cheapest' in result ? result.cheapest : undefined,
        denyReason: 'reason' in result ? result.reason : undefined,
      });
      return NextResponse.json({
        cached: true,
        consumable: label,
        findings,
        ...result,
        reason: reason.why,
        explained_by: reason.source,
      });
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
  const reason = await explainAndLog({
    consumable: consumable as ConsumableRow,
    findings,
    cap,
    decision: result.decision,
    pick: 'pick' in result ? result.pick : null,
    cheapest: 'cheapest' in result ? result.cheapest : undefined,
    denyReason: 'reason' in result ? result.reason : undefined,
  });

  return NextResponse.json({
    cached: false,
    consumable: label,
    findings,
    ...result,
    reason: reason.why,
    explained_by: reason.source,
  });
}
