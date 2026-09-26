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

const card: React.CSSProperties = {
  border: '1px solid #e5e7eb', borderRadius: 12, padding: 18, marginBottom: 16, background: '#fff',
};
const h2: React.CSSProperties = { margin: '0 0 4px', fontSize: 15, fontWeight: 700 };
const sub: React.CSSProperties = { margin: '0 0 12px', fontSize: 12.5, color: '#6b7280' };
const mono: React.CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5 };

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
      <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none' }}>
        {shops.map((option, index) => (
          <li key={`${option.shop}-${index}`} style={{ ...mono, padding: '3px 0', color: '#374151' }}>
            {option.shop}
            {option.price ? ` · ${option.price}` : ''}
            {option.evidenceUrl ? (
              <>
                {' · '}
                <a href={option.evidenceUrl} target="_blank" rel="noreferrer" style={{ color: '#1d4ed8' }}>
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
  return <div style={{ ...mono, marginTop: 6, color: '#374151' }}>{parts.join(' · ')}</div>;
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
      // The API routes verify the caller's JWT. The panel and the agent go through
      // the same door — there is no unauthenticated path to spending.
      const { data: sessionData } = await browserClient().auth.getSession();
      const jwt = sessionData.session?.access_token;
      if (!jwt) throw new Error('not signed in');
      const authHeader = { Authorization: `Bearer ${jwt}` };

      const signalRes = await fetch(`/api/signal?user_id=${userId}`, { headers: authHeader });
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
        headers: { 'Content-Type': 'application/json', ...authHeader },
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
        headers: { 'Content-Type': 'application/json', ...authHeader },
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

  return (
    <main style={{ fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif', maxWidth: 780, margin: '0 auto', padding: '32px 20px 64px', color: '#111827', background: '#f9fafb', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 26, margin: '0 0 4px' }}>Replenish Autopilot</h1>
      <p style={{ ...sub, fontSize: 13.5 }}>Your cart runs itself — and only you can see what it knows.</p>

      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={h2}>Signed in as {ACCOUNTS[who].label}</div>
          <div style={{ ...sub, margin: 0 }}>
            {ACCOUNTS[who].email} — this panel reads the database with <em>their</em> credentials.
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ ...mono, fontSize: 22, fontWeight: 700 }}>{busy ? '…' : totalRows}</div>
          <div style={{ ...sub, margin: 0 }}>rows visible</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(Object.keys(ACCOUNTS) as Who[]).map((k) => (
          <button
            key={k}
            onClick={() => setWho(k)}
            style={{
              padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
              border: '1px solid ' + (who === k ? '#111827' : '#d1d5db'),
              background: who === k ? '#111827' : '#fff',
              color: who === k ? '#fff' : '#374151',
              fontWeight: who === k ? 600 : 400,
            }}
          >
            View as {ACCOUNTS[k].label}
          </button>
        ))}
      </div>

      {who === 'demo' && (
        <section style={card}>
          <div style={h2}>Run it</div>
          <p style={sub}>Signal, then compare the shops, then order only if the live token allows it.</p>
          <button
            onClick={() => void runLoop()}
            disabled={running || busy || live.length === 0}
            style={{
              padding: '9px 16px', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 13,
              cursor: running || busy || live.length === 0 ? 'default' : 'pointer',
              background: running || live.length === 0 ? '#d1d5db' : '#111827',
              color: running || live.length === 0 ? '#6b7280' : '#fff',
            }}
          >
            {running ? 'Running…' : 'Run replenishment'}
          </button>
          {runNote && <div style={{ ...mono, marginTop: 10, color: '#374151' }}>{runNote}</div>}
        </section>
      )}

      {error && (
        <div style={{ ...card, borderColor: '#fca5a5', background: '#fef2f2', color: '#991b1b', fontSize: 13 }}>
          {error}
        </div>
      )}

      <section style={card}>
        <div style={h2}>What I let it watch</div>
        <p style={sub}>Opt in per category. Everything else is invisible to the agent.</p>
        {consent.length === 0 ? (
          <div style={{ ...sub, margin: 0 }}>Nothing granted.</div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {consent.map((c) => (
              <span key={c.category} style={{
                ...mono, padding: '5px 11px', borderRadius: 999,
                background: c.granted ? '#ecfdf5' : '#f3f4f6',
                color: c.granted ? '#065f46' : '#6b7280',
                border: '1px solid ' + (c.granted ? '#a7f3d0' : '#e5e7eb'),
              }}>
                {c.category}: {c.granted ? 'allowed' : 'off'}
              </span>
            ))}
          </div>
        )}
      </section>

      <section style={card}>
        <div style={h2}>What it actually knows about me</div>
        <p style={sub}>No profile, no purchase history. This is the whole record.</p>
        {consumables.length === 0 ? (
          <div style={{ ...sub, margin: 0 }}>No rows for this person.</div>
        ) : (
          consumables.map((c) => (
            <div key={c.id} style={{ ...mono, padding: '10px 0', borderTop: '1px solid #f3f4f6' }}>
              {c.product_key} · every {c.cadence_days} days · empty {c.est_empty_date} · source {c.source}
            </div>
          ))
        )}
      </section>

      <section style={card}>
        <div style={h2}>What it&apos;s allowed to spend</div>
        <p style={sub}>A capped, category-scoped, expiring token. It cannot overreach, even if it hallucinates.</p>
        {tokens.length === 0 ? (
          <div style={{ ...sub, margin: 0 }}>No tokens for this person.</div>
        ) : (
          tokens.map((t) => (
            <div key={t.id} style={{
              display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
              padding: '12px 0', borderTop: '1px solid #f3f4f6',
            }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ ...mono, fontWeight: 600 }}>
                  £{Number(t.max_amount).toFixed(2)} · {t.category_scope} · {new Date(t.expires_at).toLocaleDateString()}
                </div>
                <div style={{ ...sub, margin: 0 }}>{t.status === 'active' ? 'still live' : 'revoked'}</div>
              </div>
              {t.status === 'active' ? (
                <button
                  onClick={() => revoke(t.id)}
                  style={{ padding: '9px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#dc2626', color: '#fff', fontWeight: 600, fontSize: 13 }}
                >
                  Revoke
                </button>
              ) : (
                <span style={{ ...mono, color: '#9ca3af' }}>— inert</span>
              )}
            </div>
          ))
        )}
        {live.length === 0 && tokens.length > 0 && (
          <p style={{ ...sub, margin: '12px 0 0', color: '#dc2626' }}>
            No live tokens. The agent cannot spend a penny.
          </p>
        )}
      </section>

      <section style={card}>
        <div style={h2}>What it did, and why</div>
        <p style={sub}>Every action, the options it compared, and the reason for its choice.</p>
        {audit.length === 0 ? (
          <div style={{ ...sub, margin: 0 }}>No activity for this person.</div>
        ) : (
          audit.map((r) => (
            <div key={r.id} style={{ padding: '10px 0', borderTop: '1px solid #f3f4f6' }}>
              <div style={{ ...mono, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong>{r.action}</strong>
                <span style={{
                  padding: '2px 8px', borderRadius: 999, fontSize: 11,
                  background: r.choice === 'allow' ? '#ecfdf5' : r.choice === 'escalate' ? '#fffbeb' : '#fef2f2',
                  color: r.choice === 'allow' ? '#065f46' : r.choice === 'escalate' ? '#92400e' : '#991b1b',
                }}>
                  {r.choice}
                </span>
                <span style={{ color: '#9ca3af', fontSize: 11.5 }}>
                  {new Date(r.created_at).toLocaleTimeString()}
                </span>
              </div>
              <div style={{ fontSize: 13, color: '#4b5563', marginTop: 3 }}>{r.reason}</div>
              <AuditOptions inputs={r.inputs} options={r.options} shopNames={shopNames} />
            </div>
          ))
        )}
      </section>

      <p style={{ ...sub, fontSize: 12, textAlign: 'center' }}>
        Rows are scoped to you by row-level security. Switch identity above and the other person&apos;s view is empty.
      </p>
    </main>
  );
}
