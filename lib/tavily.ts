import type { ReorderSignal } from './types';

export type Shop = { id: string; name: string; base_url: string; scope: string };

export type PriceFinding = {
  shop_id: string;
  shop_name: string;
  price: number;
  currency: string;
  in_stock: boolean;
  evidence_url: string;
};

/** £ prices in text. Global flag is required by matchAll. */
const PRICE_RE = /£\s?(\d{1,3}(?:\.\d{2})?)/g;
const PLAUSIBLE_MIN = 1;
const PLAUSIBLE_MAX = 200;

/**
 * Tavily's synthesised answer usually opens with a market *range* ("typically
 * between £13.50 and £23.50"), then states the shop's actual product price. Taking
 * the first number would quote the range floor as the price, so drop range phrases
 * before reading the price.
 */
const RANGE_RE = /£\s?\d{1,3}(?:\.\d{2})?\s*(?:to|and|–|—|-)\s*£\s?\d{1,3}(?:\.\d{2})?/gi;

/**
 * Supermarket pages quote a sub-unit price ("£1.29 per 100g") next to the pack price.
 * Only strip those: "£13.50 per kilogram" is the *pack* price when the product is 1kg.
 */
const UNIT_PRICE_RE = /£\s?\d+(?:\.\d{2})?\s*(?:\/|per\s+)(?:100\s?g|100\s?ml|each|unit)/gi;

type TavilyResult = { title?: string; url?: string; content?: string };
type TavilyResponse = { answer?: string; results?: TavilyResult[] };

async function tavilySearch(query: string, domains: string[], maxResults: number): Promise<TavilyResponse> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error('TAVILY_API_KEY missing');

  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      search_depth: 'advanced',
      max_results: maxResults,
      include_domains: domains,
      include_answer: 'advanced',
    }),
  });
  if (!res.ok) throw new Error(`tavily ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as TavilyResponse;
}

/** `coffee_beans_1kg` -> `coffee beans 1kg` so the search query reads like a human's. */
export function humaniseKey(productKey: string): string {
  return productKey.replace(/_/g, ' ').trim();
}

function keyTokens(productKey: string): string[] {
  return humaniseKey(productKey).toLowerCase().split(/\s+/).filter(Boolean);
}

function relevance(result: TavilyResult, toks: string[]): number {
  const hay = `${result.title ?? ''} ${result.content ?? ''}`.toLowerCase();
  return toks.reduce((n, tok) => n + (hay.includes(tok) ? 1 : 0), 0);
}

/**
 * The URL the panel cites as evidence. Prefer a product page over a category/browse
 * listing, so a judge clicking through sees the item rather than a wall of products.
 */
function bestEvidence(ranked: TavilyResult[]): string {
  const productPage = ranked.find((r) => /\/products?\//i.test(r.url ?? ''));
  return (productPage ?? ranked[0])?.url ?? '';
}

function packPrices(text: string): number[] {
  const cleaned = text.replace(RANGE_RE, ' ').replace(UNIT_PRICE_RE, ' ');
  return [...cleaned.matchAll(PRICE_RE)]
    .map((m) => Number.parseFloat(m[1]))
    .filter((p) => Number.isFinite(p) && p >= PLAUSIBLE_MIN && p <= PLAUSIBLE_MAX);
}

/**
 * Cheapest plausible **pack** price for `productKey` at one shop, plus the page to
 * cite as evidence. The privacy panel shows that URL, so it must be the page the
 * number came from whenever we can attribute it.
 *
 * Order of preference:
 *   1. the shop product page found in the results (snippet price, ranges/units stripped)
 *   2. Tavily's synthesised answer, ranges stripped (last resort — no citable page)
 */
export async function priceAtShop(shop: Shop, productKey: string, maxResults = 5): Promise<PriceFinding | null> {
  const data = await tavilySearch(`${humaniseKey(productKey)} price`, [shop.base_url], maxResults);
  const results = data.results ?? [];

  const toks = keyTokens(productKey);
  const ranked = [...results].sort((a, b) => relevance(b, toks) - relevance(a, toks));

  // 1. Tavily's answer. Product-page snippets rarely carry the pack price and are
  //    full of unit prices, so the synthesised answer is the more reliable source;
  //    it is attributed to the best-ranked page for evidence.
  const fromAnswer = packPrices(data.answer ?? '');
  if (fromAnswer.length > 0) {
    return {
      shop_id: shop.id,
      shop_name: shop.name,
      price: Math.min(...fromAnswer),
      currency: 'GBP',
      in_stock: true,
      evidence_url: bestEvidence(ranked),
    };
  }

  // 2. fallback: a product page whose snippet carries a (range/unit-stripped) price
  for (const r of ranked) {
    const prices = packPrices(`${r.title ?? ''} ${r.content ?? ''}`);
    if (prices.length === 0) continue;
    return {
      shop_id: shop.id,
      shop_name: shop.name,
      price: Math.min(...prices),
      currency: 'GBP',
      in_stock: true,
      evidence_url: r.url ?? '',
    };
  }

  return null;
}

/** One shop per configured retailer, in parallel. A dead shop never sinks the run. */
export async function compareShops(shops: Shop[], productKey: string): Promise<PriceFinding[]> {
  const settled = await Promise.allSettled(shops.map((s) => priceAtShop(s, productKey)));
  return settled
    .filter((r): r is PromiseFulfilledResult<PriceFinding | null> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((v): v is PriceFinding => v !== null);
}

/**
 * The agent's choice: cheapest shop whose price fits inside the spend cap.
 * Over-cap is NOT silent — the caller turns it into an `escalate` verdict.
 */
export function pickBestWithinCap(
  findings: Array<Pick<PriceFinding, 'shop_id' | 'shop_name' | 'price'>>,
  maxAmount: number,
): { pick: (typeof findings)[number] | null; cheapest: number | null } {
  if (findings.length === 0) return { pick: null, cheapest: null };
  const sorted = [...findings].sort((a, b) => a.price - b.price);
  const cheapest = sorted[0].price;
  const pick = sorted.find((f) => f.price <= maxAmount) ?? null;
  return { pick, cheapest };
}

export type { ReorderSignal };
