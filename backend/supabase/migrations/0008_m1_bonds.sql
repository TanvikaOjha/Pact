-- M1 fidelity-bond mirror (chain authoritative; see PactEscrow Bond events).
-- One row per engagement; slashed_amount tracks the burned total on-chain.
create table if not exists bonds (
  engagement_id uuid primary key references engagements(id),
  amount integer not null,
  bonder_wallet text not null,
  posted_at timestamptz default now(),
  frozen boolean not null default false,
  settled_at timestamptz,
  slashed_amount integer not null default 0
);
