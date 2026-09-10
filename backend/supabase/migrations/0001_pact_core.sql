-- Pact backend cache schema (spec section 9 + proposals table).
-- On-chain is authoritative; Supabase mirrors for UX + notifications.

create extension if not exists "pgcrypto";

create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null unique,
  privy_wallet_id text not null,
  ens_subname text not null,
  world_session_id text,
  world_verified_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists engagements (
  id uuid primary key default gen_random_uuid(),
  on_chain_id text not null,
  ens_subname text not null,
  party_a_id uuid references businesses(id),
  party_b_id uuid references businesses(id),
  template_type integer not null check (template_type between 1 and 6),
  terms_hash text not null,
  total_amount integer not null,
  status text check (status in ('PROPOSED','ACTIVE','COMPLETED','DISPUTED','CANCELLED')),
  created_at timestamptz default now(),
  completed_at timestamptz
);

create table if not exists milestones (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid references engagements(id),
  index integer not null,
  name text,
  description text,
  amount integer not null,
  due_date timestamptz,
  submitted_at timestamptz,
  released_at timestamptz,
  disputed boolean default false,
  world_session_id text,
  unique (engagement_id, index)
);

create table if not exists reputation_events (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid references engagements(id),
  business_id uuid references businesses(id),
  counterparty_id uuid references businesses(id),
  template_type integer,
  total_value integer,
  on_time boolean,
  disputed boolean,
  tx_hash text,
  emitted_at timestamptz default now()
);

-- Ephemeral pre-signature proposals (not in spec section 9, required for link flow).
create table if not exists proposals (
  token text primary key,
  template_type integer not null,
  fields jsonb not null,
  proposer_id uuid references businesses(id),
  expires_at timestamptz not null,
  created_at timestamptz default now()
);
