-- When a dispute was raised (null while undisputed). Powers the 30-day
-- stale-dispute escalation without a separate tracking table.
alter table milestones add column disputed_at timestamptz;
