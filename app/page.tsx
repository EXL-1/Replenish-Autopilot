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
type Token = { id: string; max_amount: string; category_scope: string; expires_at: string; status: string };
type Audit = { id: string; action: string; choice: string; reason: string; created_at: string };
type Consent = { category: string; granted: boolean };

const card: React.CSSProperties = {
  border: '1px solid #e5e7eb', borderRadius: 12, padding: 18, marginBottom: 16, background: '#fff',
};
const h2: React.CSSProperties = { margin: '0 0 4px', fontSize: 15, fontWeight: 700 };
const sub: React.CSSProperties = { margin: '0 0 12px', fontSize: 12.5, color: '#6b7280' };
const mono: React.CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5 };

export default function Page() {
  const [who, setWho] = useState<Who>('demo');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [consumables, setConsumables] = useState<Consumable[]>([]);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [consent, setConsent] = useState<Consent[]>([]);
  const [shopCount, setShopCount] = useState(0);

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

      // Every query below runs under RLS with the signed-in user's token.
      // No service-role key ever reaches the browser.
      const [c, t, a, k, s] = await Promise.all([
        sb.from('consumables').select('*').order('est_empty_date'),
        sb.from('spend_tokens').select('*').order('issued_at', { ascending: false }).limit(5),
        sb.from('audit_log').select('*').order('created_at', { ascending: false }).limit(12),
        sb.from('consent').select('category, granted').order('category'),
        sb.from('shops').select('id'),
      ]);

      setConsumables((c.data ?? []) as Consumable[]);
      setTokens((t.data ?? []) as Token[]);
      setAudit((a.data ?? []) as Audit[]);
      setConsent((k.data ?? []) as Consent[]);
      setShopCount((s.data ?? []).length);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(who);
  }, [who, load]);

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
