'use client';

import { useCallback, useEffect, useState } from 'react';
import { browserClient } from '@/lib/supabase-browser';

const PASSWORD = 'ReplenishDemo2026';
const ACCOUNTS = {
  demo: { email: 'demo@replenish.app', label: 'Demo shopper' },
  other: { email: 'other@replenish.app', label: 'Someone else' },
} as const;
type Who = keyof typeof ACCOUNTS;

type Consumable = { id: string; product_key: string; cadence_days: number; est_empty_date: string; source: string };
type Token = {
  id: string;
  shop_id: string;
  max_amount: string;
  category_scope: string;
  expires_at: string;
  status: string;
};
type Audit = {
  id: string;
  action: string;
  choice: string;
  reason: string;
  created_at: string;
  inputs: unknown;
  options: unknown;
};
type Consent = { category: string; granted: boolean };

function gbp(value: unknown): string | null {
  const amount = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(amount)) return null;
  return `£${amount.toFixed(2)}`;
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function AuditOptions({
  inputs,
  options,
  shopNames,
}: {
  inputs: unknown;
  options: unknown;
  shopNames: Record<string, string>;
}) {
  const shops = Array.isArray(options)
    ? options.flatMap((raw) => {
        const row = record(raw);
        if (!row || (typeof row.shop !== 'string' && row.price == null)) return [];
        return [{
          shop: typeof row.shop === 'string' ? row.shop : 'shop',
          price: gbp(row.price),
          evidenceUrl: typeof row.evidence_url === 'string' ? row.evidence_url : null,
        }];
      })
    : [];

  if (shops.length > 0) {
    return (
      <ul className="options mono">
        {shops.map((option, index) => (
          <li key={`${option.shop}-${index}`}>
            {option.shop}
            {option.price ? ` · ${option.price}` : ''}
            {option.evidenceUrl ? (
              <>
                {' · '}
                <a href={option.evidenceUrl} target="_blank" rel="noreferrer">
                  evidence
                </a>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    );
  }

  const bag: Record<string, unknown> = {};
  for (const source of [inputs, ...(Array.isArray(options) ? options : [options])]) {
    const row = record(source);
    if (row) Object.assign(bag, row);
  }

  // order.placed records the requested and charged amounts separately, because
  // Shopify is authoritative on price — our scraped price and the store's
  // catalogue price can differ. Fall back to a plain `amount` for older rows.
  const charged = gbp(bag.charged_amount);
  const requested = gbp(bag.requested_amount);
  const money =
    charged && requested && requested !== charged
      ? `${charged} (asked ${requested})`
      : (charged ?? requested ?? gbp(bag.amount));

  // Resolve the shop to a name; a raw UUID is unreadable on a demo screen.
  const shopId = typeof bag.shop_id === 'string' ? bag.shop_id : null;
  const shop =
    typeof bag.shop === 'string'
      ? bag.shop
      : shopId
        ? (shopNames[shopId] ?? `shop ${shopId.slice(0, 8)}…`)
        : null;

  const cap = gbp(bag.cap);
  const parts = [
    shop,
    money,
    bag.order_ref != null && bag.order_ref !== '' ? `order ${bag.order_ref}` : null,
    cap ? `cap ${cap}` : null,
  ].filter(Boolean);

  if (parts.length === 0) return null;
  return <div className="mono detail">{parts.join(' · ')}</div>;
}

export default function Page() {
  const [who, setWho] = useState<Who>('demo');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [consumables, setConsumables] = useState<Consumable[]>([]);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [consent, setConsent] = useState<Consent[]>([]);
  const [shopCount, setShopCount] = useState(0);
  const [shopNames, setShopNames] = useState<Record<string, string>>({});
  const [userId, setUserId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runNote, setRunNote] = useState<string | null>(null);

  const load = useCallback(async (key: Who) => {
    setBusy(true);
    setError(null);
    try {
      const sb = browserClient();
      const { error: authErr } = await sb.auth.signInWithPassword({
        email: ACCOUNTS[key].email,
        password: PASSWORD,
      });
      if (authErr) throw authErr;
      const { data: userData } = await sb.auth.getUser();
      setUserId(userData.user?.id ?? null);

      // Every query below runs under RLS with the signed-in user's token.
      // No service-role key ever reaches the browser.
      const [c, t, a, k, s] = await Promise.all([
        sb.from('consumables').select('*').order('est_empty_date'),
        sb.from('spend_tokens').select('*').order('issued_at', { ascending: false }).limit(5),
        sb.from('audit_log').select('*').order('created_at', { ascending: false }).limit(12),
        sb.from('consent').select('category, granted').order('category'),
        sb.from('shops').select('id, name'),
      ]);

      setConsumables((c.data ?? []) as Consumable[]);
      setTokens((t.data ?? []) as Token[]);
      setAudit((a.data ?? []) as Audit[]);
      setConsent((k.data ?? []) as Consent[]);
      setShopCount((s.data ?? []).length);
      setShopNames(
        Object.fromEntries(
          ((s.data ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(who);
  }, [who, load]);

  async function runLoop() {
    const token = tokens.find((t) => t.status === 'active');
    if (!userId || !token || running) return;
    setRunning(true);
    setError(null);
    setRunNote('Checking what is about to run out.');
    try {
      const signalRes = await fetch(`/api/signal?user_id=${userId}`);
      const signalJson = await signalRes.json();
      if (!signalRes.ok) throw new Error(signalJson.error ?? 'signal failed');
      const signal = signalJson.signals?.[0];
      if (!signal) {
        setRunNote('Nothing is due. No order placed.');
        return;
      }

      setRunNote(`${signal.product_key.replaceAll('_', ' ')} is ${signal.days_until_empty} days out. Comparing shops.`);
      const compareRes = await fetch('/api/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          consumable_id: signal.consumable_id,
          max_amount: Number(token.max_amount),
        }),
      });
      const compareJson = await compareRes.json();
      if (!compareRes.ok) throw new Error(compareJson.error ?? compareJson.reason ?? 'compare failed');
      if (compareJson.decision !== 'allow' || !compareJson.pick) {
        setRunNote(compareJson.reason ?? 'No shop was within the cap. No order placed.');
        await load(who);
        return;
      }

      const pick = compareJson.pick as { shop_name: string; price: number };
      setRunNote(`Chose ${pick.shop_name} at £${Number(pick.price).toFixed(2)}. Placing the order on the shop this token allows.`);
      const orderRes = await fetch('/api/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token_id: token.id,
          consumable_id: signal.consumable_id,
          shop_id: token.shop_id,
          amount: pick.price,
          category: token.category_scope,
        }),
      });
      const orderJson = await orderRes.json();
      if (!orderRes.ok || !orderJson.ok) {
        setRunNote(orderJson.reason ?? 'Order blocked.');
        await load(who);
        return;
      }
      setRunNote(`Order ${orderJson.order_ref} placed.`);
      await load(who);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'run failed');
      setRunNote(null);
    } finally {
      setRunning(false);
    }
  }

  async function revoke(id: string) {
    const sb = browserClient();
    await sb
      .from('spend_tokens')
      .update({ status: 'revoked', revoked_at: new Date().toISOString() })
      .eq('id', id);
    await load(who);
  }

  const live = tokens.filter((t) => t.status === 'active');
  const totalRows = consumables.length + tokens.length + audit.length + consent.length + shopCount;

  const choiceClass = (choice: string) =>
    choice === 'allow' || choice === 'escalate' ? `choice choice-${choice}` : 'choice choice-deny';

  return (
    <>
      <div className="bg-blobs" aria-hidden="true">
        <div className="blob blob-a" />
        <div className="blob blob-b" />
        <div className="blob blob-c" />
      </div>
      <main className="shell">
        <header className="hero">
          <p className="eyebrow">Privacy panel</p>
          <h1>Replenish Autopilot</h1>
          <p className="lede">Your cart runs itself — and only you can see what it knows.</p>
        </header>

        <div className="card identity">
          <div className="identity-copy">
            <h2>Signed in as {ACCOUNTS[who].label}</h2>
            <p className="sub flat">
              {ACCOUNTS[who].email} — this panel reads the database with <em>their</em> credentials.
            </p>
          </div>
          <div className="stat">
            <div className="stat-value">{busy ? '…' : totalRows}</div>
            <p className="sub flat">rows visible</p>
          </div>
        </div>

        <div className="switcher">
          {(Object.keys(ACCOUNTS) as Who[]).map((k) => (
            <button
              key={k}
              onClick={() => setWho(k)}
              className={who === k ? 'btn btn-accent' : 'btn btn-ghost'}
            >
              View as {ACCOUNTS[k].label}
            </button>
          ))}
        </div>

        {who === 'demo' && (
          <section className="card">
            <h2>Run it</h2>
            <p className="sub">Signal, then compare the shops, then order only if the live token allows it.</p>
            <button
              onClick={() => void runLoop()}
              disabled={running || busy || live.length === 0}
              className="btn btn-accent"
            >
              {running ? 'Running…' : 'Run replenishment'}
            </button>
            {runNote && <div className="mono run-note">{runNote}</div>}
          </section>
        )}

        {error && <div className="card error">{error}</div>}

        <section className="card">
          <h2>What I let it watch</h2>
          <p className="sub">Opt in per category. Everything else is invisible to the agent.</p>
          {consent.length === 0 ? (
            <p className="sub flat">Nothing granted.</p>
          ) : (
            <div className="pills">
              {consent.map((c) => (
                <span key={c.category} className={c.granted ? 'pill pill-on' : 'pill pill-off'}>
                  {c.category}: {c.granted ? 'allowed' : 'off'}
                </span>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <h2>What it actually knows about me</h2>
          <p className="sub">No profile, no purchase history. This is the whole record.</p>
          {consumables.length === 0 ? (
            <p className="sub flat">No rows for this person.</p>
          ) : (
            consumables.map((c) => (
              <div key={c.id} className="mono list-row">
                {c.product_key} · every {c.cadence_days} days · empty {c.est_empty_date} · source {c.source}
              </div>
            ))
          )}
        </section>

        <section className="card">
          <h2>What it&apos;s allowed to spend</h2>
          <p className="sub">A capped, category-scoped, expiring token. It cannot overreach, even if it hallucinates.</p>
          {tokens.length === 0 ? (
            <p className="sub flat">No tokens for this person.</p>
          ) : (
            tokens.map((t) => (
              <div key={t.id} className="list-row token-row">
                <div className="token-copy">
                  <div className="mono token-title">
                    £{Number(t.max_amount).toFixed(2)} · {t.category_scope} · {new Date(t.expires_at).toLocaleDateString()}
                  </div>
                  <p className="sub flat">{t.status === 'active' ? 'still live' : 'revoked'}</p>
                </div>
                {t.status === 'active' ? (
                  <button onClick={() => revoke(t.id)} className="btn btn-danger">
                    Revoke
                  </button>
                ) : (
                  <span className="mono inert">— inert</span>
                )}
              </div>
            ))
          )}
          {live.length === 0 && tokens.length > 0 && (
            <p className="sub warn">No live tokens. The agent cannot spend a penny.</p>
          )}
        </section>

        <section className="card">
          <h2>What it did, and why</h2>
          <p className="sub">Every action, the options it compared, and the reason for its choice.</p>
          {audit.length === 0 ? (
            <p className="sub flat">No activity for this person.</p>
          ) : (
            audit.map((r) => (
              <div key={r.id} className="list-row">
                <div className="mono audit-head">
                  <strong>{r.action}</strong>
                  <span className={choiceClass(r.choice)}>{r.choice}</span>
                  <span className="when">{new Date(r.created_at).toLocaleTimeString()}</span>
                </div>
                <div className="reason">{r.reason}</div>
                <AuditOptions inputs={r.inputs} options={r.options} shopNames={shopNames} />
              </div>
            ))
          )}
        </section>

        <p className="footnote">
          Rows are scoped to you by row-level security. Switch identity above and the other person&apos;s view is empty.
        </p>
      </main>
    </>
  );
}
