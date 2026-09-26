// Shared contract types — see CONTRACT.md. Do not change without both owners.

export type ReorderSignal = {
  consumable_id: string;
  product_key: string;
  est_empty_date: string;
  days_until_empty: number;
  source: 'recharge' | 'csv_seed';
};

export type Verdict =
  | { decision: 'allow' }
  | { decision: 'deny'; reason: string }
  | { decision: 'escalate'; reason: string };

export type SpendToken = {
  id: string;
  user_id: string;
  shop_id: string;
  max_amount: number;
  category_scope: string;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
  status: 'active' | 'revoked' | 'expired';
};

export type AuditRecord = {
  action: string;
  inputs: unknown;
  options: unknown;
  choice: string;
  reason: string;
  token_id?: string;
};
