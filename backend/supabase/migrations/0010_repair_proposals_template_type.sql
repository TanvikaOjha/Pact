-- Repair databases where the proposals table was created before the
-- template_type column was included in the canonical schema.
alter table proposals
  add column if not exists template_type integer not null default 1;

alter table proposals
  drop constraint if exists proposals_template_type_check;

alter table proposals
  add constraint proposals_template_type_check
  check (template_type between 1 and 6);
