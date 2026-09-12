-- Optional contact email for lifecycle notifications (submission, release,
-- disputes, auto-release reminders). Null means log-only for that business.
alter table businesses add column email text;
