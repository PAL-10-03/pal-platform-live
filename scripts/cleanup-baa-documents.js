'use strict';
// Fail-closed cleanup: only BAA Document Uploads files with independently verified
// QuickBooks transaction AND attachment proof are eligible after a 24-hour buffer.
require('dotenv').config();
const crypto = require('node:crypto');
const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const bucket = process.env.PAL_SUPABASE_BUCKET || 'pal-private-documents';
const prefix = 'born-again-air/documents/';
const proofPrefix = 'born-again-air/retention/verified/';
const auditPrefix = 'born-again-air/retention/audits/';
const bufferMs = 24 * 60 * 60 * 1000;
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
const safeDocName = name => typeof name === 'string' && /^\d{13}-[a-f0-9]{12}-[a-zA-Z0-9][a-zA-Z0-9._ ()-]{0,119}\.(pdf|png|jpe?g|xlsx|xls|csv)$/i.test(name);
const proofPath = name => `${proofPrefix}${crypto.createHash('sha256').update(`${prefix}${name}`).digest('hex')}.json`;
async function getProof(name) {
  try {
    const response = await request(`object/${encodeURIComponent(bucket)}/${proofPath(name)}`);
    return await response.json();
  } catch (error) {
    if (error.status === 404 || (error.status === 400 && /not found/i.test(error.message))) return null;
    throw error;
  }
}
function verified(file, proof, now) {
  if (!safeDocName(file.name) || !proof || typeof proof !== 'object') return false;
  if (proof.schemaVersion !== 1 || proof.tenant !== 'born-again-air' || proof.status !== 'verified') return false;
  if (proof.storagePath !== `${prefix}${file.name}` || proof.destination !== 'quickbooks-online') return false;
  if (typeof proof.transactionId !== 'string' || !proof.transactionId.trim()) return false;
  if (typeof proof.attachmentId !== 'string' || !proof.attachmentId.trim()) return false;
  if (proof.transactionConfirmed !== true || proof.attachmentConfirmed !== true) return false;
  const verifiedAt = Date.parse(proof.verifiedAt || '');
  const uploadedAt = Date.parse(file.created_at || '');
  if (!Number.isFinite(verifiedAt) || !Number.isFinite(uploadedAt)) return false;
  if (verifiedAt > now || uploadedAt > now) return false;
  if (verifiedAt < uploadedAt || now - verifiedAt < bufferMs) return false;
  return true;
}
async function writeJson(path, value) {
  await request(`object/${encodeURIComponent(bucket)}/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-upsert': 'true' }, body: JSON.stringify(value),
  });
}
async function main() {
  const now = Date.now();
  const all = (await listAll()).filter(f => safeDocName(f.name));
  const eligible = [];
  for (const file of all) {
    const proof = await getProof(file.name);
    if (verified(file, proof, now)) eligible.push({ file, proof });
  }
  console.log(JSON.stringify({ event: 'baa_verified_cleanup_scan', documentsScanned: all.length, verifiedAndEligible: eligible.length, deletionEnabled: enabled, timestamp: new Date(now).toISOString() }));
  if (!enabled) { console.log('DRY RUN: No documents deleted.'); return; }
  const deleted = [];
  // Delete one at a time to make auditing precise and avoid batch ambiguity.
  for (const { file } of eligible) {
    const path = `${prefix}${file.name}`;
    const response = await request(`object/${encodeURIComponent(bucket)}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [path] }),
    });
    const result = await response.json();
    if (!Array.isArray(result) || result.length !== 1) throw new Error(`Deletion could not be confirmed for ${file.name}`);
    deleted.push({ path, proofPath: proofPath(file.name) });
  }
  const completedAt = new Date().toISOString();
  const auditName = `${auditPrefix}${completedAt.replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}.json`;
  await writeJson(auditName, { completedAt, deletedCount: deleted.length, deleted });
  console.log(`Cleanup complete: ${deleted.length} verified BAA Document Uploads files deleted; audit ${auditName}`);
}
main().catch(error => { console.error('Cleanup failed:', error.message); process.exitCode = 1; });
