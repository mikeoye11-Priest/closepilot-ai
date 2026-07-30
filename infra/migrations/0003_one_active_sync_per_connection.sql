-- Belt-and-suspenders backstop for the application-level concurrent-sync guard:
-- at most one active (queued/running) sync run per connection, so two syncs can
-- never refresh a rotating OAuth refresh token (QuickBooks / Sage) in parallel
-- and invalidate the connection.
--
-- The app already expires stuck runs and refuses a second in-flight sync; this
-- index makes it a hard guarantee even under a true simultaneous-request race.

-- Clear any long-stuck active runs first so the unique index can be created
-- (mirrors the app watchdog: runs still active past the route max-duration are
-- treated as timed out).
update accounting_sync_runs
  set status = 'failed',
      error_message = coalesce(error_message, 'Sync timed out — cleared during migration.'),
      completed_at = coalesce(completed_at, now())
  where status in ('queued', 'running')
    and started_at < now() - interval '10 minutes';

create unique index if not exists one_active_sync_per_connection
  on accounting_sync_runs (integration_id)
  where status in ('queued', 'running');
