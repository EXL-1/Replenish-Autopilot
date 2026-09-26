const domain = process.env.SHOPIFY_STORE_DOMAIN;
const token = process.env.SHOPIFY_ADMIN_TOKEN;
const apiVersion = process.env.SHOPIFY_API_VERSION ?? '2025-07';

export type LineItem = { variant_id: string; quantity: number };

export type PlacedOrder = {
  /** Shopify order id, as a string (it exceeds JS safe-integer range as a number). */
  id: string;
  /** What Shopify actually charged. Authoritative. */
  total_price: number;
  currency: string;
};

/**
 * One-click order on the dev store (test mode). Returns the Shopify order id.
 * Critical path — no order lands without SHOPIFY_STORE_DOMAIN + SHOPIFY_ADMIN_TOKEN.
 */
export async function placeOrder(items: LineItem[], note = 'Replenish Autopilot'): Promise<PlacedOrder> {
  if (!domain || !token) throw new Error('Shopify env vars missing');

  const res = await fetch(`https://${domain}/admin/api/${apiVersion}/orders.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      order: {
        line_items: items,
        note,
        financial_status: 'paid',
        test: true, // Shopify test-order flag; no real charge
      },
    }),
  });

  if (!res.ok) throw new Error(`Shopify order failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return {
    id: String(json.order.id),
    total_price: Number(json.order.total_price),
    currency: String(json.order.currency ?? ''),
  };
}
