import type { SpendToken, Verdict } from './types';

export type SpendRequest = {
  amount: number;
  category: string;
  shop_id: string;
  now?: Date;
};

/**
 * The single guardrail. Denies or escalates anything outside the token's
 * cap / category scope / TTL. `deny` and `escalate` never place an order.
 */
export function checkToken(token: SpendToken | null | undefined, req: SpendRequest): Verdict {
  const now = req.now ?? new Date();

  if (!token) return { decision: 'deny', reason: 'no token supplied' };
  if (token.status !== 'active' || token.revoked_at) {
    return { decision: 'deny', reason: 'token revoked or inactive' };
  }
  if (new Date(token.expires_at).getTime() <= now.getTime()) {
    return { decision: 'deny', reason: 'token expired' };
  }
  if (token.shop_id !== req.shop_id) {
    return { decision: 'deny', reason: 'token scoped to a different shop' };
  }
  if (token.category_scope !== req.category) {
    return {
      decision: 'deny',
      reason: `category "${req.category}" outside scope "${token.category_scope}"`,
    };
  }
  if (req.amount > token.max_amount) {
    return {
      decision: 'escalate',
      reason: `amount ${req.amount} exceeds cap ${token.max_amount}`,
    };
  }
  return { decision: 'allow' };
}
