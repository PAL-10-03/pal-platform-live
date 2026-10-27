# Born Again Air Document Center — retention job setup

This ZIP adds XLSX, XLS, and CSV support to the existing PDF/JPG/PNG Document Center. It does not modify `baa-api.js` (box calculations, prices, Excel exports or labels).

## Important: deployment is a separate step

The cleanup code is **included but NOT scheduled by deploying the web service ZIP alone**. A scheduler must be configured. In Render, create a separate Cron Job using the same repo and environment variables, with:

- Command: `node scripts/cleanup-baa-documents.js`
- Cron schedule: `0 3 * * *` (daily at 03:00 UTC). The job runs daily and removes files **at least 10 full days old** on the first eligible daily run.
- Environment: `SUPABASE_URL`, `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`, and optionally `PAL_SUPABASE_BUCKET` (default `pal-private-documents`).
- Start with `PAL_CLEANUP_ENABLE_DELETE=false`. Run once and check logs for the eligible count. Only set `PAL_CLEANUP_ENABLE_DELETE=true` **after** approving record retention and verifying necessary source documents are preserved elsewhere.

Each run checks the `born-again-air/documents/` prefix **only**, and only recognizes the Document Center's timestamp-prefixed filenames. It deletes files **at least 10 full days old** (using the later of the upload filename timestamp and Supabase `created_at`). It never targets BAA box records, price lists, or database files.

After a successful deletion run it writes an audit and last-run marker in `born-again-air/retention/`, outside the document folder. If the scheduler is offline, the next daily run will pick up the overdue cleanup. Errors stop the job without advancing the marker.

**Caution:** This system does not yet know whether an uploaded document has been posted to QuickBooks, is under duplicate review, or must be retained for tax/legal reasons. Until accounting retention is implemented, leave deletion disabled or explicitly approve the risk. The audit is not a replacement for the deleted document.

To test after deployment: upload a small XLSX, XLS, and CSV file, refresh, download each, and verify the contents. Run the cleanup job in dry-run mode and confirm no current files are eligible. Finally check Supabase Storage's `pal-private-documents/born-again-air/documents/` path and usage.

## Manual deletion
The Document Center has **Delete Selected** beside **Download Selected**. Only PAL owner and Born Again Air managers can delete; the user must confirm. This permanently deletes the selected originals from Supabase Storage.

## Activation
**Deploying the ZIP alone does not schedule cleanup.** In Render, create a Cron Job using the same repository and Supabase environment variables, command `node scripts/cleanup-baa-documents.js`, schedule `0 3 * * *`. Test first with `PAL_CLEANUP_ENABLE_DELETE=false`, then set it to `true` only after verifying the retention policy. This job has no QuickBooks awareness and can delete unmatched or legally necessary originals. Retain accounting records separately.
