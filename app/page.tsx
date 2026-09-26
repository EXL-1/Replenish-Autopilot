// STUB — Gabriel owns the privacy panel UI (consent, data-touched, token card,
// audit trail over Supabase Realtime). This is only the scaffold seat.

export default function Page() {
  return (
    <main style={{ fontFamily: 'system-ui', padding: 32, maxWidth: 720 }}>
      <h1>Replenish Autopilot</h1>
      <p>Trust layer scaffold is live. Privacy panel lands in the 14:30 block.</p>
      <ul>
        <li><code>GET /api/signal?user_id=&lt;id&gt;</code> — emit ReorderSignals</li>
        <li><code>POST /api/order</code> — policy check → Shopify order → audit row</li>
      </ul>
    </main>
  );
}
