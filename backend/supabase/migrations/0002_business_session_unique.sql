-- Backstop for World session replay: one session verifies one business.
-- NULLs are exempt (Postgres UNIQUE allows multiple NULLs), so legacy or
-- session-less rows are unaffected.
alter table businesses
  add constraint businesses_world_session_id_unique unique (world_session_id);
