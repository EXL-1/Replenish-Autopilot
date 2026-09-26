/**
 * Grok explains the pick. It never makes it.
 *
 * The policy engine (`lib/policy-engine.ts`) is the only thing allowed to return
 * `allow`, and `checkToken` runs on whatever this module suggests. If Grok is
 * unreachable, slow or returns nonsense, the caller keeps its template reason and
 * the deterministic cheapest-within-cap pick — the demo must still finish.
 *
 * What Grok is given: the reorder signal, the three prices we already fetched, and
 * the mandate's constraints. What it is NOT given: any profile, the Shopify admin
 * token, the service-role key, or any tool that could reach a card.
 *
 * `store: false` is deliberate. The Responses API otherwise retains the
 * conversation for 30 days — which is a profile, and we promised not to build one.
 * Web search stays off: Tavily is already the evidence, and a second search would
 * widen what the agent knows.
 */

const ENDPOINT = 'https://api.x.ai/v1/responses';
/**
 * Measured against the real prompt: the reasoning models take 8-10s, which is most
 * of a demo. This one answers in ~1s and — checked against grok-4.5, which
 * incorrectly claimed no order was placed — is also the more accurate of the two,
 * because the task is describing a situation rather than reasoning about one.
 */
const MODEL = process.env.XAI_MODEL ?? 'grok-4.20-0309-non-reasoning';
const TIMEOUT_MS = Number(process.env.XAI_TIMEOUT_MS ?? 20_000);

export type Finding = { shop: string; price: number; evidence_url?: string };

export type Mandate = {
  /** The shop the token is scoped to — usually NOT the cheapest one. */
  shop: string;
  cap: number;
  category: string;
  expires_on: string;
};

export type Pick = { shop: string; amount: number };

export type Reason = {
  why: string;
  /** 'grok' when the model answered, 'fallback' when it didn't. The panel shows both. */
  source: 'grok' | 'fallback';
};

const SYSTEM = `You explain a purchasing decision for a shopping agent, in one sentence.

HOW THE FLOW WORKS — this matters, read it carefully:
- We compare prices across several shops. Those shops are the prices we FOUND, not a choice list.
- We then place the order at the shop the user's spending mandate is scoped to.
- The mandate's shop is routinely NOT the cheapest shop found. That is expected and permitted.
- An order WILL be placed at the mandate's shop. Never say an order cannot be placed, and never
  say no purchase was made. The mandate's shop is a real shop.

You will be given: a reorder signal, the prices found, and the mandate's constraints.

Write ONE sentence, under 200 characters, explaining where the order goes and why. If the
cheapest shop is not the mandate's shop, say so plainly — that contradiction is the point of
the explanation, not a problem to smooth over.

Rules:
- Never claim you placed an order or will place one. You are explaining a decision.
- Never suggest exceeding the cap, the category, or the shop scope.
- No preamble, no hedging, no bullet points. One sentence.

Reply as JSON: {"shop": "<the shop the order goes to>", "amount": <number>, "why": "<one sentence>"}`;

function userPrompt(
  signal: { product_key: string; days_until_empty: number; source: string },
  findings: Finding[],
  mandate: Mandate,
): string {
  const prices = findings
    .map((f) => `  - ${f.shop}: £${f.price.toFixed(2)}`)
    .join('\n');

  return `Reorder signal
  item: ${signal.product_key.replaceAll('_', ' ')}
  empty in: ${signal.days_until_empty} days
  detected from: ${signal.source}

Prices found
${prices}

Spending mandate
  cap: £${mandate.cap.toFixed(2)}
  category: ${mandate.category}
  scoped to shop: ${mandate.shop}
  expires: ${mandate.expires_on}

The order will be placed at: ${mandate.shop}`;
}

/** The model may wrap JSON in prose or fences despite instructions. Dig it out. */
function parseJson(text: string): { shop?: unknown; amount?: unknown; why?: unknown } | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const start = c.indexOf('{');
    const end = c.lastIndexOf('}');
    if (start === -1 || end <= start) continue;
    try {
      return JSON.parse(c.slice(start, end + 1));
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/**
 * Ask Grok to explain the decision. Returns the sentence to write into
 * `audit_log.reason`. Always resolves — falls back rather than throwing, because
 * a model outage must not break the order path.
 */
export async function reasonAboutPick(
  signal: { product_key: string; days_until_empty: number; source: string },
  findings: Finding[],
  mandate: Mandate,
  fallbackWhy: string,
): Promise<Reason> {
  const key = process.env.XAI_API_KEY;
  if (!key) return { why: fallbackWhy, source: 'fallback' };
  if (findings.length === 0) return { why: fallbackWhy, source: 'fallback' };

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        input: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: userPrompt(signal, findings, mandate) },
        ],
        store: false, // no 30-day retention — that would be the profile we promised not to build
        max_output_tokens: 300,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      console.warn('[grok] HTTP', res.status, (await res.text()).slice(0, 200));
      return { why: fallbackWhy, source: 'fallback' };
    }

    const json = (await res.json()) as {
      output?: { type?: string; content?: { type?: string; text?: string }[] }[];
    };

    const message = json.output?.find((o) => o.type === 'message');
    const text = message?.content?.find((c) => c.type === 'output_text')?.text ?? '';
    const parsed = parseJson(text);
    const why = typeof parsed?.why === 'string' ? parsed.why.trim() : '';

    if (!why) {
      console.warn('[grok] unusable reply:', text.slice(0, 160));
      return { why: fallbackWhy, source: 'fallback' };
    }

    return { why: why.slice(0, 300), source: 'grok' };
  } catch (e) {
    console.warn('[grok] call failed:', e instanceof Error ? e.message : e);
    return { why: fallbackWhy, source: 'fallback' };
  }
}
