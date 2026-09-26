// Reset the demo to a clean, repeatable state.
//
// Why this exists: revoking the token is the demo's closing beat, and it is
// irreversible by design. Without this, a rehearsal leaves no live token and the
// real run is dead. Run it before every rehearsal and before the real demo.
//
// Run: npm run reset:demo
import { createClient } from '@supabase/supabase-js';
import { reasonAboutPick } from '../lib/grok.ts';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Try: node --env-file=.env.local --experimental-strip-types scripts/reset-demo.ts');
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

const DEMO_EMAIL = 'demo@replenish.app';
const DEMO_PRODUCT = 'coffee_beans_1kg';
const CAP = 40;
// A real order that exists in the Shopify dev store, so the seeded trail points
// at something a judge can actually open. Do not invent order refs here.
const REAL_ORDER_REF = '13722714014079';
const REAL_ORDER_CHARGED = 12.0;
const REAL_ORDER_REQUESTED = 13.5;

function fail(step: string, error: { message?: string } | null) {
  if (error) {
    console.error(`  FAILED at ${step}: ${error.message}`);
    process.exit(1);
  }
  console.log(`  ok  ${step}`);
}

// 1. who is the demo user
const { data: users, error: userErr } = await db
  .from('users')
  .select('id')
  .eq('email', DEMO_EMAIL)
  .limit(1);
fail('looked up the demo user', userErr);
if (!users?.length) {
  console.error(`  FAILED: no user row for ${DEMO_EMAIL}`);
  process.exit(1);
}
const userId = users[0].id as string;
console.log(`\nresetting demo state for ${DEMO_EMAIL} (${userId})\n`);

// 2. its shop — the token is shop-scoped, so this must be exact
const { data: shops, error: shopErr } = await db
  .from('shops')
  .select('id, name')
  .eq('user_id', userId);
fail('read the shops', shopErr);
const shop = (shops ?? []).find((s) => /shopify/i.test(String(s.name))) ?? (shops ?? [])[0];
if (!shop) {
  console.error('  FAILED: no shop rows for the demo user');
  process.exit(1);
}
console.log(`  shop: ${shop.name} (${shop.id})`);

// 3. revoke every token, then issue exactly one live one
fail('revoked existing tokens', (
  await db
    .from('spend_tokens')
    .update({ status: 'revoked', revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('status', 'active')
).error);

// Prune old revoked tokens. Every rehearsal adds one and they never leave, so the
// pile grows without bound. Keep the newest few — the panel shows revoked tokens as
// the "it cannot spend" evidence, so the history is the point — and drop the rest.
{
  const { data: revoked } = await db
    .from('spend_tokens')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'revoked')
    .order('issued_at', { ascending: false });

  const ids = (revoked ?? []).map((r) => r.id as string);
  const drop = ids.slice(3);
  if (drop.length > 0) {
    await db.from('spend_tokens').delete().in('id', drop);
  }
  console.log(`  pruned ${drop.length} old revoked tokens, kept ${ids.length - drop.length}`);
}

const { data: token, error: tokenErr } = await db
  .from('spend_tokens')
  .insert({
    user_id: userId,
    shop_id: shop.id,
    max_amount: CAP.toFixed(2),
    category_scope: 'consumables',
    status: 'active',
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
  })
  .select('id, max_amount, expires_at')
  .single();
fail('issued one live token', tokenErr);

// 4. consent — the categories the panel shows
fail('cleared consent', (await db.from('consent').delete().eq('user_id', userId)).error);
fail(
  'granted consent',
  (
    await db.from('consent').insert([
      { user_id: userId, category: 'consumables', granted: true },
      { user_id: userId, category: 'household', granted: true },
      { user_id: userId, category: 'electronics', granted: false },
    ])
  ).error,
);

// 5. the one consumable the agent is allowed to know about
//
// Deleting consumables CASCADES to orders (orders.consumable_id is ON DELETE CASCADE),
// so this also clears order history. That is fine for a clean demo slate, but it must
// not happen silently — an agent holding ids from before the reset will fail its own
// insert afterwards.
const ordersBefore = (
  await db.from('orders').select('id').eq('user_id', userId)
).data?.length ?? 0;

fail('cleared consumables', (await db.from('consumables').delete().eq('user_id', userId)).error);

const ordersAfter = (
  await db.from('orders').select('id').eq('user_id', userId)
).data?.length ?? 0;
if (ordersBefore !== ordersAfter) {
  console.log(
    `  note  cleared ${ordersBefore - ordersAfter} order row(s) by cascade — restart the agent after a reset`,
  );
}
fail(
  'seeded consumables',
  (
    await db.from('consumables').insert([
      {
        user_id: userId,
        product_key: DEMO_PRODUCT,
        cadence_days: 28,
        source: 'recharge',
        est_empty_date: new Date(Date.now() + 4 * 24 * 3600 * 1000).toISOString().slice(0, 10),
      },
      {
        user_id: userId,
        product_key: 'oat_milk_6x1l',
        cadence_days: 14,
        source: 'recharge',
        est_empty_date: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString().slice(0, 10),
      },
      {
        user_id: userId,
        product_key: 'toothpaste_100ml',
        cadence_days: 60,
        source: 'csv_seed',
        est_empty_date: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString().slice(0, 10),
      },
    ])
  ).error,
);

// 6. audit trail — the three beats, oldest first
fail('cleared the audit trail', (await db.from('audit_log').delete().eq('user_id', userId)).error);
const beat = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

// The seeded compare row should read like a live one, so the panel opens on the same
// sentence pressing Run would produce. Same fallback discipline as the app: if Grok is
// slow, down, or returns junk, the deterministic reason stands and the demo still runs.
const seededFindings = [
  { shop: 'Tesco', price: 14.25 },
  { shop: 'Waitrose', price: 13.5 },
  { shop: 'Ocado', price: 14.7 },
];
const compareReason = await reasonAboutPick(
  { product_key: DEMO_PRODUCT, days_until_empty: 4, source: 'recharge' },
  seededFindings,
  {
    shop: shop.name,
    cap: Number(token?.max_amount ?? CAP),
    category: 'consumables',
    expires_on: token?.expires_at ? String(token.expires_at).slice(0, 10) : 'unknown',
  },
  'cheapest within cap: £13.5 at Waitrose',
);
console.log(`  compare reason: ${compareReason.source} — ${compareReason.why.slice(0, 80)}`);

fail(
  'seeded the audit trail',
  (
    await db.from('audit_log').insert([
      {
        user_id: userId,
        action: 'compare',
        inputs: {
          product_key: DEMO_PRODUCT,
          max_amount: CAP,
          explained_by: compareReason.source,
        },
        options: seededFindings,
        choice: 'allow',
        reason: compareReason.why,
        created_at: beat(3),
      },
      {
        user_id: userId,
        action: 'order.placed',
        inputs: { product_key: DEMO_PRODUCT, shop_id: shop.id, amount: REAL_ORDER_REQUESTED },
        options: {
          shop_id: shop.id,
          requested_amount: REAL_ORDER_REQUESTED,
          charged_amount: REAL_ORDER_CHARGED,
          order_ref: REAL_ORDER_REF,
        },
        choice: 'allow',
        reason: `within cap ${CAP}, scope consumables`,
        created_at: beat(2),
      },
      {
        user_id: userId,
        action: 'order.blocked',
        inputs: { amount: REAL_ORDER_REQUESTED },
        options: { cap: CAP },
        choice: 'deny',
        reason: 'token revoked or inactive',
        created_at: beat(1),
      },
    ])
  ).error,
);

console.log(`
  live token : ${token?.id}
  cap        : £${CAP}
  expires    : ${token?.expires_at}
  audit trail: 3 seeded beats (compare / placed / blocked)

Ready for a run. The demo's own order will append to this trail.
`);
