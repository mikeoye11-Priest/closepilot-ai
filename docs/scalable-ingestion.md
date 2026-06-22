# Scalable ingestion and retention

ClosePilot separates ingestion from analysis so uploaded files and accounting integrations use the same assurance pipeline.

## Target flow

1. The browser uploads large files directly to private Supabase Storage using TUS resumable upload.
2. ClosePilot creates a queued analysis job containing only the storage key and tenant/company scope.
3. A worker claims the job, parses bounded chunks, writes checkpoints, and emits findings and aggregates.
4. Xero and future connectors queue the same type of job, with provider page cursors instead of storage byte offsets.
5. The UI polls job state and can recover after refresh or interruption.

The first implemented slice queues Xero work with Next.js `after()` and lets the browser poll its durable `accounting_sync_runs` record. The next slice moves page processing to a dedicated worker and adds canonical incremental caching.

## Retention policy

- Raw uploads: 90 days by default.
- Temporary parser chunks: delete after successful analysis or within 24 hours.
- Accounting API page caches: retain only until the next successful checkpoint unless audit policy requires longer.
- Findings, evidence references, sign-offs and audit logs: retain according to the customer contract.
- Never copy complete source datasets into browser workspace state.

## Cost model

Raw files belong in object storage; Postgres should contain job state, mappings, findings, evidence excerpts and aggregates. Storing every ledger row permanently in Postgres costs more and increases index, backup and maintenance overhead.

At 100 MB per monthly client pack with 90-day retention:

- 100 clients use approximately 30 GB of object storage.
- 500 clients use approximately 150 GB.

Actual usage varies with upload frequency, compression, Xero page caching and contractual retention.

## Production acceptance targets

- 100 MB upload and 1,000,000 CSV rows.
- Ten concurrent tenant-isolated jobs.
- Resume from the last committed checkpoint after termination.
- Idempotent retries without duplicate findings or source records.
- Visible progress, cancellation and actionable failure messages.
- Storage lifecycle deletion verified by audit log.

