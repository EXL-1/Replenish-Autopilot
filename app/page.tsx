'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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

function humanise(value: string): string {
  const words = value.replaceAll('_', ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : value;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/London',
  }).format(new Date(value));
}

function formatActivityTime(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London',
  }).format(new Date(value));
}

function describeDue(value: string): string {
  const target = new Date(`${value}T12:00:00Z`);
  const today = new Date();
  const days = Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days > 1) return `in ${days} days`;
  if (days === -1) return 'yesterday';
  return `${Math.abs(days)} days ago`;
}

function sourceLabel(source: string): string {
  if (source === 'recharge') return 'Subscription schedule';
  if (source === 'csv_seed') return 'Imported schedule';
  return humanise(source);
}

function friendlyCompareReason(reason: string): string {
  const fallback = reason.match(/^cheapest within cap:\s*(.+)\s+at\s+(.+)$/i);
  if (fallback) return `${fallback[2]} had the lowest price within your limit at ${fallback[1]}.`;
  return reason
    .replace(/per the spending mandate/gi, 'because it matched your spending permission')
    .replace(/the spending mandate/gi, 'your spending permission')
    .replace(/spending mandate/gi, 'spending permission');
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
        const priceValue =
          typeof row.price === 'number' || typeof row.price === 'string' ? Number(row.price) : NaN;
        return [{
          shop: typeof row.shop === 'string' ? row.shop : 'shop',
          price: gbp(row.price),
          priceValue,
          evidenceUrl: typeof row.evidence_url === 'string' ? row.evidence_url : null,
        }];
      })
    : [];

  if (shops.length > 0) {
    const lowest = Math.min(...shops.map((option) => option.priceValue).filter(Number.isFinite));
    return (
      <div className="shop-results">
        {shops.map((option, index) => (
          <div
            className={option.priceValue === lowest ? 'shop-result shop-result-best' : 'shop-result'}
            key={`${option.shop}-${index}`}
          >
            <div>
              <strong>{option.shop}</strong>
              {option.priceValue === lowest && <span className="best-label">Lowest found</span>}
            </div>
            <div className="shop-result-price">
              <strong>{option.price ?? '—'}</strong>
            {option.evidenceUrl ? (
                <a href={option.evidenceUrl} target="_blank" rel="noreferrer">
                  Source ↗
                </a>
              ) : null}
            </div>
          </div>
        ))}
      </div>
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

  const facts = [
    shop ? { label: 'Shop', value: shop } : null,
    money ? { label: 'Amount', value: money } : null,
    bag.order_ref != null && bag.order_ref !== ''
      ? { label: 'Order reference', value: String(bag.order_ref) }
      : null,
    gbp(bag.cap) ? { label: 'Spending limit', value: gbp(bag.cap) as string } : null,
  ].filter((fact): fact is { label: string; value: string } => fact !== null);

  if (facts.length === 0) return null;
  return (
    <dl className="activity-facts">
      {facts.map((fact) => (
        <div key={fact.label}>
          <dt>{fact.label}</dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function auditPresentation(row: Audit) {
  if (row.action === 'order.placed') {
    const details = record(row.options);
    if (details?.persisted === false) {
      return {
        title: 'Order placed, record incomplete',
        status: 'Needs attention',
        tone: 'warning',
        icon: '!',
        description: 'The order reached the shop, but Replenish could not save the full receipt.',
      };
    }
    return {
      title: 'Order placed',
      status: 'Completed',
      tone: 'success',
      icon: '✓',
      description: 'The order passed every spending rule and was placed.',
    };
  }
  if (row.action === 'order.blocked') {
    const reason = row.reason.toLowerCase();
    let description = `Replenish stopped this order: ${row.reason}.`;
    if (reason.includes('revoked') || reason.includes('inactive')) {
      description = 'Replenish stopped this order because automatic spending was turned off.';
    } else if (reason.includes('expired')) {
      description = 'Replenish stopped this order because the spending permission had expired.';
    } else if (reason.includes('different shop')) {
      description = 'Replenish stopped this order because that shop was not approved.';
    } else if (reason.includes('outside scope') || reason.includes('wrong category')) {
      description = 'Replenish stopped this order because that type of item was not approved.';
    } else if (reason.includes('exceeds cap') || reason.includes('over cap')) {
      description = 'Replenish stopped this order because it was over your spending limit.';
    } else if (reason.includes('no token')) {
      description = 'Replenish stopped this order because no spending permission was available.';
    }
    return {
      title: 'Order stopped',
      status: 'Blocked',
      tone: 'blocked',
      icon: '×',
      description,
    };
  }
  if (row.action === 'compare') {
    const allowed = row.choice === 'allow';
    return {
      title: 'Prices checked',
      status: allowed ? 'Within budget' : row.choice === 'escalate' ? 'Needs approval' : 'No safe option',
      tone: allowed ? 'success' : row.choice === 'escalate' ? 'warning' : 'blocked',
      icon: '£',
      description: friendlyCompareReason(row.reason),
    };
  }
  return {
    title: humanise(row.action.replaceAll('.', ' ')),
    status: humanise(row.choice),
    tone: row.choice === 'allow' ? 'success' : row.choice === 'escalate' ? 'warning' : 'blocked',
    icon: '•',
    description: row.reason,
  };
}

function ActivityItem({ row, shopNames }: { row: Audit; shopNames: Record<string, string> }) {
  const presentation = auditPresentation(row);
  return (
    <li className="activity-entry">
      <span className={`activity-icon activity-icon-${presentation.tone}`} aria-hidden="true">
        {presentation.icon}
      </span>
      <div className="activity-content">
        <div className="activity-heading">
          <div>
            <h3>{presentation.title}</h3>
            <span className={`activity-status activity-status-${presentation.tone}`}>
              {presentation.status}
            </span>
          </div>
          <time dateTime={row.created_at}>{formatActivityTime(row.created_at)}</time>
        </div>
        <p>{presentation.description}</p>
        <details className="receipt-details">
          <summary>View receipt</summary>
          <div className="receipt-content">
            <AuditOptions inputs={row.inputs} options={row.options} shopNames={shopNames} />
            <p className="system-event">System event: {row.action}</p>
          </div>
        </details>
      </div>
    </li>
  );
}

export default function Page() {
  const [who, setWho] = useState<Who>('demo');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [consumables, setConsumables] = useState<Consumable[]>([]);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [consent, setConsent] = useState<Consent[]>([]);
  const [shopNames, setShopNames] = useState<Record<string, string>>({});
  const [userId, setUserId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runNote, setRunNote] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLElement>(null);

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

  useEffect(() => {
    if (!accountOpen) return;
    function onPointer(event: MouseEvent) {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setAccountOpen(false);
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [accountOpen]);

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
      const approvedShop = shopNames[token.shop_id] ?? 'your approved shop';
      setRunNote(
        `Lowest price found: ${pick.shop_name} at £${Number(pick.price).toFixed(2)}. ` +
        `Your spending permission allows ${approvedShop}, so that is where the test order will go.`,
      );
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
      const charged = gbp(orderJson.order?.amount);
      setRunNote(
        `Test order ${orderJson.order_ref} placed at ${approvedShop}` +
        `${charged ? ` for ${charged}` : ''}. No money was charged.`,
      );
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

  const live = tokens.filter(
    (t) => t.status === 'active' && new Date(t.expires_at).getTime() > Date.now(),
  );
  const activeToken = live[0];
  const previousTokens = tokens.filter((t) => t.id !== activeToken?.id);
  const primaryConsumable = consumables[0];
  const allowedConsent = consent.filter((item) => item.granted);
  const recentAudit = audit.slice(0, 4);
  const olderAudit = audit.slice(4);

  return (
    <>
      <div className="bg-blobs" aria-hidden="true">
        <div className="blob blob-a" />
        <div className="blob blob-b" />
        <div className="blob blob-c" />
      </div>
      <div className="page">
        <aside className="account-dock" ref={accountRef} aria-label="Signed-in account">
          <button
            type="button"
            className="account-trigger"
            aria-expanded={accountOpen}
            aria-haspopup="menu"
            onClick={() => setAccountOpen((open) => !open)}
          >
            <span className="account-kicker">Signed in as</span>
            <span className="account-name">{ACCOUNTS[who].label}</span>
          </button>
          {accountOpen && (
            <div className="account-menu" role="menu">
              {(Object.keys(ACCOUNTS) as Who[])
                .filter((k) => k !== who)
                .map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="menuitem"
                    className="btn btn-ghost"
                    onClick={() => {
                      setWho(k);
                      setAccountOpen(false);
                    }}
                  >
                    View as {ACCOUNTS[k].label}
                  </button>
                ))}
            </div>
          )}
        </aside>
        <main className="shell">
          <header className="hero">
            <p className="eyebrow">Privacy panel</p>
            <h1>Replenish Autopilot</h1>
            <p className="lede">Your cart runs itself | only you can see what it knows.</p>
          </header>

          {who === 'demo' ? (
            <section className={running ? 'card action-card is-running' : 'card action-card'}>
              <div className="action-layout">
                <div className="action-copy">
                  <p className="section-label">Your next refill</p>
                  <div className="due-status">
                    <span className={activeToken ? 'status-dot status-dot-on' : 'status-dot'} />
                    {busy
                      ? 'Loading your refill plan…'
                      : primaryConsumable
                        ? `${humanise(primaryConsumable.product_key)} is due ${describeDue(primaryConsumable.est_empty_date)}`
                        : 'Nothing needs restocking right now'}
                  </div>
                  <h2>
                    {busy
                      ? 'Getting everything ready'
                      : !activeToken
                        ? 'Automatic reordering is paused'
                        : primaryConsumable
                          ? `Let Replenish handle ${humanise(primaryConsumable.product_key).toLowerCase()}`
                          : 'You are all stocked up'}
                  </h2>
                  <p>
                    {activeToken
                      ? `We’ll compare approved shops and only place an order if it stays within your ${gbp(activeToken.max_amount)} limit.`
                      : 'A new spending permission is needed before Replenish can place an order.'}
                  </p>
                  <div className="action-controls">
                    <button
                      onClick={() => void runLoop()}
                      disabled={running || busy || !activeToken || !primaryConsumable}
                      className="btn btn-accent btn-primary-action"
                    >
                      {running
                        ? 'Checking shops…'
                        : !activeToken
                          ? 'Reordering paused'
                          : !primaryConsumable
                            ? 'Nothing to reorder'
                            : 'Check prices & reorder'}
                    </button>
                    <span>Demo mode: creates a Shopify test order. No money is charged.</span>
                  </div>
                </div>
                <ol className="journey" aria-label="How Replenish works">
                  <li>
                    <span>1</span>
                    <div>
                      <strong>Check what&apos;s low</strong>
                      <p>Uses your refill schedule.</p>
                    </div>
                  </li>
                  <li>
                    <span>2</span>
                    <div>
                      <strong>Compare shops</strong>
                      <p>Looks for a suitable price.</p>
                    </div>
                  </li>
                  <li>
                    <span>3</span>
                    <div>
                      <strong>Apply your limits</strong>
                      <p>Only orders when every rule passes.</p>
                    </div>
                  </li>
                </ol>
              </div>
              {runNote && (
                <div className="run-status" role="status" aria-live="polite">
                  <span className={running ? 'run-status-spinner' : 'run-status-check'} aria-hidden="true">
                    {running ? '' : '✓'}
                  </span>
                  {runNote}
                </div>
              )}
            </section>
          ) : (
            <section className="card empty-account">
              <span className="empty-lock" aria-hidden="true">✓</span>
              <p className="section-label">Private by design</p>
              <h2>No shopping data for this account</h2>
              <p>
                This account cannot see the demo shopper&apos;s products, spending permissions, or activity.
              </p>
            </section>
          )}

          {error && (
            <div className="notice notice-error" role="alert">
              <strong>Something went wrong</strong>
              <span>{error}</span>
            </div>
          )}

          {who === 'demo' && (
            <>
              <section className="page-section" aria-labelledby="safeguards-title">
                <div className="section-heading">
                  <p className="section-label">You stay in control</p>
                  <h2 id="safeguards-title">Your safeguards</h2>
                  <p>These boundaries are enforced before Replenish can buy anything.</p>
                </div>

                <div className="safeguards-grid">
                  <article className="card safeguard-card">
                    <div className="card-title-row">
                      <div>
                        <p className="section-label">Access</p>
                        <h3>What Replenish can see</h3>
                      </div>
                      <span className="count-badge">{allowedConsent.length} allowed</span>
                    </div>
                    {consent.length === 0 ? (
                      <p className="empty-copy">No categories are shared.</p>
                    ) : (
                      <ul className="permission-list">
                        {consent.map((item) => (
                          <li key={item.category}>
                            <span
                              className={item.granted ? 'permission-mark permission-mark-on' : 'permission-mark'}
                              aria-hidden="true"
                            >
                              {item.granted ? '✓' : '—'}
                            </span>
                            <span>{humanise(item.category)}</span>
                            <strong>{item.granted ? 'Allowed' : 'Not shared'}</strong>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="card-note">Everything else stays invisible to the agent.</p>
                  </article>

                  <article className="card safeguard-card">
                    <div className="card-title-row">
                      <div>
                        <p className="section-label">Spending</p>
                        <h3>Your purchase limit</h3>
                      </div>
                      <span className={activeToken ? 'live-badge' : 'paused-badge'}>
                        <span aria-hidden="true" />
                        {activeToken ? 'On' : 'Paused'}
                      </span>
                    </div>
                    {activeToken ? (
                      <>
                        <div className="limit-amount">
                          {gbp(activeToken.max_amount)}
                          <span>maximum per order</span>
                        </div>
                        <dl className="limit-details">
                          <div>
                            <dt>For</dt>
                            <dd>{humanise(activeToken.category_scope)} only</dd>
                          </div>
                          <div>
                            <dt>Until</dt>
                            <dd>{formatDate(activeToken.expires_at)}</dd>
                          </div>
                        </dl>
                        <button onClick={() => void revoke(activeToken.id)} className="btn btn-stop">
                          Turn off automatic spending
                        </button>
                      </>
                    ) : (
                      <div className="paused-state">
                        <strong>Automatic spending is off</strong>
                        <p>Replenish cannot place an order.</p>
                      </div>
                    )}
                    {previousTokens.length > 0 && (
                      <details className="history-details">
                        <summary>
                          {previousTokens.length === 1
                            ? '1 previous permission'
                            : `${previousTokens.length} previous permissions`}
                        </summary>
                        <div className="history-list">
                          {previousTokens.map((token) => (
                            <div key={token.id}>
                              <span>{gbp(token.max_amount)} · {humanise(token.category_scope)}</span>
                              <strong>
                                {new Date(token.expires_at).getTime() <= Date.now() ? 'Expired' : 'Off'}
                              </strong>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </article>
                </div>
              </section>

              <section className="page-section" aria-labelledby="data-title">
                <div className="section-heading">
                  <p className="section-label">Data kept to a minimum</p>
                  <h2 id="data-title">What Replenish knows</h2>
                  <p>Only the information needed to predict your next refill.</p>
                </div>
                <div className="card knowledge-card">
                  {consumables.length === 0 ? (
                    <div className="empty-state">
                      <strong>No products are being watched</strong>
                      <p>There is no refill data stored for this account.</p>
                    </div>
                  ) : (
                    <div className="known-items">
                      {consumables.map((item) => (
                        <article className="known-item" key={item.id}>
                          <span className="product-initial" aria-hidden="true">
                            {humanise(item.product_key).charAt(0)}
                          </span>
                          <div>
                            <h3>{humanise(item.product_key)}</h3>
                            <p>
                              Expected to run out {formatDate(item.est_empty_date)} · usually lasts {item.cadence_days} days
                            </p>
                            <span>{sourceLabel(item.source)}</span>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                  <div className="privacy-promise">
                    <span aria-hidden="true">✓</span>
                    <p>
                      <strong>That&apos;s the whole record.</strong> No profile, browsing history, or full purchase history.
                    </p>
                  </div>
                </div>
              </section>

              <section className="page-section" aria-labelledby="activity-title">
                <div className="section-heading">
                  <p className="section-label">Clear and accountable</p>
                  <h2 id="activity-title">Recent activity</h2>
                  <p>A simple receipt for every price check, order, or block.</p>
                </div>
                <div className="card activity-card">
                  {audit.length === 0 ? (
                    <div className="empty-state">
                      <strong>No activity yet</strong>
                      <p>Your checks and orders will appear here.</p>
                    </div>
                  ) : (
                    <>
                      <ol className="activity-list">
                        {recentAudit.map((row) => (
                          <ActivityItem key={row.id} row={row} shopNames={shopNames} />
                        ))}
                      </ol>
                      {olderAudit.length > 0 && (
                        <details className="older-activity">
                          <summary>Show {olderAudit.length} earlier event{olderAudit.length === 1 ? '' : 's'}</summary>
                          <ol className="activity-list activity-list-older">
                            {olderAudit.map((row) => (
                              <ActivityItem key={row.id} row={row} shopNames={shopNames} />
                            ))}
                          </ol>
                        </details>
                      )}
                    </>
                  )}
                </div>
              </section>
            </>
          )}

          <p className="footnote">
            Your data is protected by row-level security. Other accounts cannot see it.
          </p>
        </main>
      </div>
    </>
  );
}
