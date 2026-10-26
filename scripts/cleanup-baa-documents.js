'use strict';
// Run daily from an external scheduler (e.g., a Render Cron Job).
// Daily scheduled run: delete files at least 32 full days old.
// Deletion is deliberately opt-in until the accounting-record retention plan is confirmed.
require('dotenv').config();
const crypto = require('node:crypto');
const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const bucket = process.env.PAL_SUPABASE_BUCKET || 'pal-private-documents';
const prefix = 'born-again-air/documents/';
const markerPath = 'born-again-air/retention/last-cleanup.json';
const auditPrefix = 'born-again-air/retention/audits/';
const ageMs = 32 * 86400000;
const enabled = process.env.PAL_CLEANUP_ENABLE_DELETE === 'true';
if (!url || !key) { console.error('Supabase credentials missing.'); process.exit(1); }
const headers = { apikey: key, Authorization: `Bearer ${key}` };
async function request(path, options = {}) {
  const response = await fetch(`${url}/storage/v1/${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  if (!response.ok) {
    const details = (await response.text()).slice(0, 300);
    const error = new Error(`Supabase storage HTTP ${response.status}: ${details}`);
    error.status = response.status;
    throw error;
  }
  return response;
}
async function getMarker() {
  try {
    const response = await request(`object/${encodeURIComponent(bucket)}/${markerPath}`);
    return await response.json();
  } catch (error) {
    if (error.status === 404 || (error.status === 400 && /not found/i.test(error.message))) return null;
    throw error;
  }
}
async function writeJson(path, value) {
  await request(`object/${encodeURIComponent(bucket)}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-upsert': 'true' },
    body: JSON.stringify(value),
  });
}
async function listAll() {
  const all = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await request(`object/list/${encodeURIComponent(bucket)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'created_at', order: 'asc' } }),
    });
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error('Unexpected storage list response');
    all.push(...batch);
    if (batch.length < 1000) return all;
  }
}
function eligible(file, now) {
  if (!file || typeof file.name !== 'string') return false;
  const match = /^(\d{13})-[a-f0-9]{12}-[a-zA-Z0-9][a-zA-Z0-9._ ()-]{0,119}$/.exec(file.name);
  if (!match) return false; // Never delete legacy, unrecognized, or app/box files.
  const fromName = Number(match[1]);
  const created = Date.parse(file.created_at || '');
  // Use the newer timestamp, so a mismatched timestamp cannot delete a young upload.
  const uploaded = Math.max(fromName, Number.isFinite(created) ? created : fromName);
  return uploaded <= now - ageMs;
}
async function main() {
  const now = Date.now();
  const files = (await listAll()).filter(f => eligible(f, now));
  console.log(JSON.stringify({ event: 'baa_cleanup_scan', eligible: files.length, deletionEnabled: enabled, timestamp: new Date(now).toISOString() }));
  if (!enabled) {
    console.log('DRY RUN: No files deleted. Set PAL_CLEANUP_ENABLE_DELETE=true only after approving document retention.');
    return;
  }
  // Supabase remove API accepts paths relative to bucket; use batches of <=1000.
  const deleted = [];
  for (let i = 0; i < files.length; i += 100) {
    const paths = files.slice(i, i + 100).map(f => `${prefix}${f.name}`);
    await request(`object/${encodeURIComponent(bucket)}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: paths }),
    });
    deleted.push(...paths);
  }
  const completedAt = new Date().toISOString();
  const audit = { completedAt, cutoff: new Date(now - ageMs).toISOString(), deletedCount: deleted.length,
    deleted: deleted.map(p => ({ path: p, filenameSha256: crypto.createHash('sha256').update(p).digest('hex') })) };
  const auditName = `${auditPrefix}${completedAt.replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}.json`;
  await writeJson(auditName, audit);
  await writeJson(markerPath, { lastCompletedAt: completedAt, deletedCount: deleted.length, auditPath: auditName });
  console.log(`Cleanup complete: ${deleted.length} eligible BAA documents deleted; audit stored at ${auditName}`);
}
main().catch(error => { console.error('Cleanup failed; check the logs and rerun safely:', error.message); process.exitCode = 1; });
