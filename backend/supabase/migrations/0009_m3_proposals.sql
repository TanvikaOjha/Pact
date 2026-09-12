-- M3 optimistic-dispute mirror (chain authoritative; see propose/challenge/execute).
-- One open proposal per (engagement, milestone); executed_at set on execution.
create table if not exists dispute_proposals (
  engagement_id uuid references engagements(id),
  milestone_index integer not null,
  provider_amount integer not null,
  client_refund integer not null,
  proposer_wallet text not null,
  challenge_deadline timestamptz not null,
  challenged boolean not null default false,
  executed_at timestamptz,
  primary key (engagement_id, milestone_index)
);
