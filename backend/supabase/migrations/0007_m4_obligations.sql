-- M4 obligations mirror (chain authoritative; see PactEscrow MilestoneTerms).
-- evidence_hash: content fingerprint committed at submitCompletion (null until
-- submitted or when the milestone needs no evidence). late: mirror of the
-- on-chain late flag for display; release paths never read it.
alter table milestones add column evidence_hash text;
alter table milestones add column late boolean not null default false;

-- Per-engagement M4/M6 terms mirror. due_date (set at proposal accept) stays
-- the deadline mirror — no separate deadline column. Chain values win.
alter table engagements add column visibility text not null default 'public';
alter table engagements add column default_provider_bps integer;
alter table engagements add column challenge_window_seconds integer;
alter table engagements add constraint engagements_visibility_check
  check (visibility in ('public', 'commit'));
