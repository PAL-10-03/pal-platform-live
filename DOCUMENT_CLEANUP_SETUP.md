# Born Again Air — Verified Processing Cleanup (replaces 10-day rule)

**Scope:** Only objects under `pal-private-documents/born-again-air/documents/` with the exact Document Uploads naming format. This job does NOT delete price lists, databases, boxes, reports, or other tenant data.

**Permanent policy:** No deletion based on age. A Document Uploads file can be deleted only after a trusted future accounting integration has verified that the original document is attached to a confirmed QuickBooks Online transaction, and **24 hours** have elapsed since verification. Missing, incomplete, inconsistent, or unknown verification = KEEP.

**Current behavior:** The QuickBooks integration and proof writer are **not built**. This ZIP does NOT create verification records, and does not allow a user to mark files verified. Existing documents have no verification proof and therefore are **not eligible** for deletion. This is intentional. Do not fabricate verification records for testing against real documents.

## Proof contract for the future QuickBooks integration

Only trusted backend code, **after independently confirming both the QuickBooks transaction and attachment**, may write a JSON object in private Supabase Storage at:

`born-again-air/retention/verified/<sha256 of the exact UTF-8 storage path>.json`

The storage path hashed is `born-again-air/documents/<stored filename>`. The proof JSON must contain:

```json
{
  "schemaVersion": 1,
  "tenant": "born-again-air",
  "status": "verified",
  "storagePath": "born-again-air/documents/<stored filename>",
  "destination": "quickbooks-online",
  "transactionId": "<actual confirmed QuickBooks transaction ID>",
  "attachmentId": "<actual confirmed QuickBooks attachment ID>",
  "transactionConfirmed": true,
  "attachmentConfirmed": true,
  "verifiedAt": "<actual ISO timestamp after upload and verification>"
}
```

This proof format is a future integration contract, **not** proof that QuickBooks has been connected. Do not add any public/client API that can write this proof. A stronger production design should also use a transactional database and recheck the QuickBooks attachment before deletion to guard against stale or forged proof; this script does not perform a live QuickBooks recheck.

## Testing and scheduling

Deploying the web-service ZIP does **not** schedule the job. If creating a Render Cron Job, use command `node scripts/cleanup-baa-documents.js`, schedule `0 3 * * *` (daily at 03:00 UTC), and copy the Supabase environment variables. **Start with `PAL_CLEANUP_ENABLE_DELETE=false`** (default), run the job, and verify `verifiedAndEligible: 0` and `DRY RUN`. Do not enable real deletion until the QuickBooks integration, verification proof, and a disposable-file end-to-end test are complete. With no QuickBooks integration, zero eligible files is expected.

**Manual Delete Selected** remains a separate manager-initiated feature and is unchanged.
