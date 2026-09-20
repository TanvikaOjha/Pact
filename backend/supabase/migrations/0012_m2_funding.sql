-- M2 tiered-funding mirror (chain authoritative; see PactEscrow.EscrowInfo
-- fundedCount/fundedTotal/defaulted and the TopUpFunded/DefaultRecorded events).
alter table engagements add column funded_count integer not null default 0;
alter table engagements add column funded_total integer not null default 0;
alter table engagements add column defaulted boolean not null default false;

-- A milestone only becomes submittable once its index is < fundedCount on
-- chain; mirrors PactEscrow.submitCompletion's MilestoneUnfunded revert.
alter table milestones add column funded boolean not null default false;