// Smoke test for the guardrail. Run: node --experimental-strip-types scripts/check-policy.ts
import { checkToken } from '../lib/policy-engine.ts';
import type { SpendToken } from '../lib/types.ts';

const base: SpendToken = {
  id: 'tok_1',
  user_id: 'user_a',
  shop_id: 'shop_1',
  max_amount: 40,
  category_scope: 'consumables',
  issued_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  revoked_at: null,
  status: 'active',
};

const cases: Array<[string, SpendToken | null, Parameters<typeof checkToken>[1], string]> = [
  ['valid within cap',              base,                                   { amount: 12, category: 'consumables', shop_id: 'shop_1' }, 'allow'],
  ['over cap',                      base,                                   { amount: 55, category: 'consumables', shop_id: 'shop_1' }, 'escalate'],
  ['revoked token',                 { ...base, status: 'revoked', revoked_at: new Date().toISOString() }, { amount: 12, category: 'consumables', shop_id: 'shop_1' }, 'deny'],
  ['expired token',                 { ...base, expires_at: new Date(Date.now() - 1000).toISOString() }, { amount: 12, category: 'consumables', shop_id: 'shop_1' }, 'deny'],
  ['wrong category',                base,                                   { amount: 12, category: 'electronics', shop_id: 'shop_1' }, 'deny'],
  ['wrong shop',                    base,                                   { amount: 12, category: 'consumables', shop_id: 'shop_9' }, 'deny'],
  ['no token',                      null,                                   { amount: 12, category: 'consumables', shop_id: 'shop_1' }, 'deny'],
];

let failures = 0;
for (const [name, token, req, expected] of cases) {
  const got = checkToken(token, req).decision;
  const pass = got === expected;
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(20)} expected=${expected.padEnd(9)} got=${got}`);
}
console.log(failures === 0 ? '\nAll guardrail cases passed.' : `\n${failures} case(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
