import { NextResponse } from 'next/server';
import { checkToken } from '@/lib/policy-engine';
import { supabaseAdmin } from '@/lib/supabase';
import { placeOrder } from '@/lib/shopify';
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

  // 1. load the token (service role: RLS bypassed, so filter explicitly)
  const { data: token, error } = await supabaseAdmin
    .from('spend_tokens')
    .select('*')
    .eq('id', token_id)
    .single();

  if (error || !token) {
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
  let orderRef: string;
  try {
    orderRef = await placeOrder([{ variant_id: String(variant_id), quantity: 1 }]);
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'shopify error';
    return NextResponse.json({ ok: false, decision: 'error', reason }, { status: 502 });
  }

  // 4. persist order + audit trail
  const { data: orderRow } = await supabaseAdmin
    .from('orders')
    .insert({ user_id: token.user_id, consumable_id, shop_id, amount, token_id, order_ref: orderRef })
    .select()
    .single();

  await supabaseAdmin.from('audit_log').insert({
    user_id: token.user_id,
    action: 'order.placed',
    inputs: body,
    options: { shop_id, amount, order_ref: orderRef },
    choice: 'allow',
    reason: `within cap ${token.max_amount}, scope ${token.category_scope}`,
  });

  return NextResponse.json({ ok: true, order_ref: orderRef, order: orderRow });
}
