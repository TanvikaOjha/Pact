-- M5 N-way split mirror (chain authoritative; see PactEscrow releaseSplit/claimShare).
-- Recipients are fixed at proposal-accept time, in on-chain array order — the
-- last recipient absorbs rounding dust, so order matters and is preserved.
create table if not exists split_recipients (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid references engagements(id),
  wallet_address text not null,
  shares_bps integer not null check (shares_bps > 0 and shares_bps <= 10000),
  position integer not null,
  unique (engagement_id, position)
);

-- pendingShares(engagementId, recipient) mirror. Amount is always re-read
-- from chain (never accumulated locally) since PactEscrow is the only
-- source of truth for whether a transfer fell back to pull-payment.
create table if not exists pending_shares (
  engagement_id uuid references engagements(id),
  wallet_address text not null,
  amount integer not null default 0,
  updated_at timestamptz default now(),
  primary key (engagement_id, wallet_address)
);