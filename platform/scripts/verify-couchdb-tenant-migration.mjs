#!/usr/bin/env node
/** Read-only verification for the database-per-organization cutover. */
import { Buffer } from 'node:buffer';
import { ORG_SCOPED_DATABASES } from './install-validate-doc-updates.mjs';

const ORG_ID_RE = /^org-[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const baseUrl = (process.env.COUCHDB_URL || '').replace(/\/+$/, '');
const adminUser = process.env.COUCHDB_ADMIN_USER || process.env.COUCHDB_USER || '';
const adminPassword = process.env.COUCHDB_ADMIN_PASSWORD || process.env.COUCHDB_PASSWORD || '';
const orgIds = (process.env.COUCHDB_TENANT_ORG_IDS || '').split(',').map(v => v.trim()).filter(Boolean);

if (!baseUrl || !adminUser || !adminPassword || orgIds.length === 0 || orgIds.some(id => !ORG_ID_RE.test(id))) {
  console.error('Set CouchDB URL/admin credentials and valid COUCHDB_TENANT_ORG_IDS.');
  process.exit(1);
}

const auth = `Basic ${Buffer.from(`${adminUser}:${adminPassword}`).toString('base64')}`;
const headers = { Authorization: auth, 'Content-Type': 'application/json' };

async function json(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  if (!response.ok) throw new Error(`${init.method || 'GET'} ${path}: HTTP ${response.status}`);
  return response.json();
}

async function countOrgDocs(dbName, orgId) {
  let bookmark;
  let total = 0;
  do {
    const body = await json(`/${encodeURIComponent(dbName)}/_find`, {
      method: 'POST',
      body: JSON.stringify({
        selector: { orgId: { $eq: orgId } },
        fields: ['_id'],
        limit: 500,
        ...(bookmark ? { bookmark } : {}),
      }),
    });
    const docs = Array.isArray(body.docs) ? body.docs : [];
    total += docs.length;
    if (docs.length < 500 || !body.bookmark || body.bookmark === bookmark) break;
    bookmark = body.bookmark;
  } while (true);
  return total;
}

let failures = 0;
for (const orgId of orgIds) {
  for (const source of ORG_SCOPED_DATABASES) {
    const target = `${source}--${orgId}`;
    try {
      const [sourceCount, targetCount, security] = await Promise.all([
        countOrgDocs(source, orgId),
        countOrgDocs(target, orgId),
        json(`/${encodeURIComponent(target)}/_security`),
      ]);
      const roles = security?.members?.roles || [];
      const securityOk = roles.length === 1 && roles[0] === `org:${orgId}`;
      const countOk = sourceCount === targetCount;
      if (!securityOk || !countOk) {
        failures++;
        console.error(`[fail] ${target} source=${sourceCount} target=${targetCount} roles=${JSON.stringify(roles)}`);
      } else {
        console.log(`[ok] ${target} documents=${targetCount}`);
      }
    } catch (error) {
      failures++;
      console.error(`[fail] ${target} ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

const scheduler = await json('/_scheduler/jobs?limit=10000');
const unhealthyJobs = (scheduler.jobs || []).filter(job =>
  typeof job.id === 'string' && job.id.startsWith('tamamhealth-') &&
  !['running', 'pending'].includes(job.state));
if (unhealthyJobs.length > 0) {
  failures += unhealthyJobs.length;
  for (const job of unhealthyJobs) console.error(`[fail] replication ${job.id} state=${job.state}`);
}

if (failures > 0) {
  console.error(`Tenant migration verification failed (${failures} issue(s)).`);
  process.exit(1);
}
console.log('Tenant migration verification passed.');

