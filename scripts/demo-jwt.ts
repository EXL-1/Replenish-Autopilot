/**
 * Mint a fresh demo JWT and put it on the clipboard.
 *
 * Grok Bots has a secure credential store ("stored securely, never shown to your Bot"),
 * which is where the Replenish bot's bearer token goes. Supabase access tokens expire
 * after an hour, so this has to be re-run shortly before the demo — a token minted in
 * the morning will be dead by the time the judges arrive.
 *
 *   npm run demo:jwt
 *
 * The token is copied to the clipboard with pbcopy and never printed. Paste it straight
 * into the bot's JWT field.
 */
import { execFileSync } from 'node:child_process';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const EMAIL = process.env.DEMO_EMAIL ?? 'demo@replenish.app';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'ReplenishDemo2026';

if (!url || !anon) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. Run with --env-file=.env.local.');
  process.exit(1);
}

const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});

if (!res.ok) {
  console.error(`Sign-in failed (${res.status}). Check the demo account password.`);
  process.exit(1);
}

const { access_token: jwt, expires_in: expiresIn, user } = (await res.json()) as {
  access_token: string;
  expires_in: number;
  user: { id: string; email: string };
};

execFileSync('pbcopy', { input: jwt });

const expiresAt = new Date(Date.now() + expiresIn * 1000);
console.log(`  signed in as : ${user.email}`);
console.log(`  subject      : ${user.id}`);
console.log(`  length       : ${jwt.length} chars (not printed)`);
console.log(`  expires      : ${expiresAt.toLocaleTimeString('en-GB')} (in ${Math.round(expiresIn / 60)} min)`);
console.log(`\n  Copied to your clipboard. Paste it into the Replenish bot's JWT field and press Save securely.`);
console.log(`  Re-run this within the last hour before the demo — the token dies after 60 minutes.`);
