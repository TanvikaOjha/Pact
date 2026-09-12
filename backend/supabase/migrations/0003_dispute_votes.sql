-- Co-signed dispute resolution votes. Two matching votes (one per party,
-- identical split) resolve the milestone; the backend mirrors the on-chain
-- quorum when both votes agree.
create table if not exists dispute_votes (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid references engagements(id),
  milestone_index integer not null,
  wallet_address text not null,
  provider_amount integer not null,
  client_refund integer not null,
  created_at timestamptz default now(),
  unique (engagement_id, milestone_index, wallet_address)
);
