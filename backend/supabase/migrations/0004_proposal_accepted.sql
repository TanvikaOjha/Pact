-- Link accepted proposals to the engagement they became, so double-accept
-- is rejected instead of forking duplicate engagements.
alter table proposals
  add column accepted_engagement_id uuid references engagements(id);
