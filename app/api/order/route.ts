import { NextResponse } from 'next/server';
import { checkToken } from '@/lib/policy-engine';
import { supabaseAdmin } from '@/lib/supabase';
import { requireUser, isDenied } from '@/lib/auth';
import { defaultVariantId, placeOrder } from '@/lib/shopify';
import type { SpendToken } from '@/lib/types';

export const runtime = 'nodejs';

/**
 * POST /api/order
 * body: { token_id, consumable_id, shop_id, amount, category, variant_id }
 *
 * Flow: policy check -> Shopify order -> orders row + audit_log row.
 * This is the 13:30 integration point.
 */
export async function POST(req: Request) {
  const body = await req.json();
  const { token_id, consumable_id, shop_id, amount, category, variant_id } = body ?? {};

  if (!token_id || !shop_id || amount == null) {
    return NextResponse.json({ ok: false, reason: 'token_id, shop_id, amount required' }, { status: 400 });
  }

  const caller = await requireUser(req);
  if (isDenied(caller)) {
    return NextResponse.json(
      { ok: false, decision: 'deny', reason: caller.error },
      { status: caller.status },
    );
  }

  // 1. load the token (service role: RLS bypassed, so filter explicitly)
  const { data: token, error } = await supabaseAdmin
    .from('spend_tokens')
    .select('*')
    .eq('id', token_id)
    .single();

  if (error || !token) {
    return NextResponse.json({ ok: false, decision: 'deny', reason: 'token not found' }, { status: 404 });
  }

  // A token issued to someone else must not be spendable by the caller, and must
  // be indistinguishable from a token that doesn't exist.
  if (token.user_id !== caller.userId) {
    return NextResponse.json({ ok: false, decision: 'deny', reason: 'token not found' }, { status: 404 });
  }

  // 2. policy engine — the guardrail
  const verdict = checkToken(token as SpendToken, { amount, category, shop_id });
  if (verdict.decision !== 'allow') {
    await supabaseAdmin.from('audit_log').insert({
      user_id: token.user_id,
      action: 'order.blocked',
      inputs: body,
      options: null,
      choice: verdict.decision,
      reason: verdict.reason,
    });
    return NextResponse.json({ ok: false, ...verdict }, { status: 403 });
  }

  // 3. place the order
  let placed;
  try {
    const variant = variant_id ? String(variant_id) : await defaultVariantId();
    placed = await placeOrder([{ variant_id: variant, quantity: 1 }]);
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'shopify error';
    return NextResponse.json({ ok: false, decision: 'error', reason }, { status: 502 });
  }

  // Shopify is authoritative on price. Our scraped price and the store's catalogue
  // price can differ, and a panel-vs-store mismatch is exactly what makes a "real
  // order" look staged. Store what was actually charged.
  const charged =
    Number.isFinite(placed.total_price) && placed.total_price > 0 ? placed.total_price : amount;

  // 4. persist order + audit trail
  const { data: orderRow } = await supabaseAdmin
    .from('orders')
    .insert({
      user_id: token.user_id,
      consumable_id,
      shop_id,
      amount: charged,
      token_id,
      order_ref: placed.id,
    })
    .select()
    .single();

  await supabaseAdmin.from('audit_log').insert({
    user_id: token.user_id,
    action: 'order.placed',
    inputs: body,
    options: {
      shop_id,
      requested_amount: amount,
      charged_amount: charged,
      order_ref: placed.id,
    },
    choice: 'allow',
    reason: `within cap ${token.max_amount}, scope ${token.category_scope}`,
  });

  return NextResponse.json({ ok: true, order_ref: placed.id, order: orderRow });
}
