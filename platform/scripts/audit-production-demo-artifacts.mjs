#!/usr/bin/env node

/**
 * Read-only production audit for demo organizations, facilities and accounts.
 * It never updates or deletes CouchDB documents.
 */
import fs from 'node:fs';

function readEnvFile(path) {
  if (!fs.existsSync(path)) return {};
  return Object.fromEntries(fs.readFileSync(path, 'utf8').split(/\r?\n/)
    .filter(line => line && !line.trimStart().startsWith('#') && line.includes('='))
    .map(line => {
      const at = line.indexOf('=');
      return [line.slice(0, at), line.slice(at + 1).replace(/^['"]|['"]$/g, '')];
    }));
}

const fileEnv = readEnvFile('.env.production');
const env = key => process.env[key] || fileEnv[key];
const base = (env('COUCHDB_URL') || '').replace(/\/+$/, '');
const username = env('COUCHDB_ADMIN_USER') || env('COUCHDB_USER');
const password = env('COUCHDB_ADMIN_PASSWORD') || env('COUCHDB_PASSWORD');

if (!base || !username || !password) {
  console.error('CouchDB connection settings are required. No changes were made.');
  process.exit(2);
}

const headers = { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` };
const knownLegacyIds = new Set([
  'hosp-mercy-001', 'org-mercy-hospital',
  'user-dr.mercy', 'user-nurse.mercy', 'user-desk.mercy', 'user-pharma.mercy', 'user-lab.mercy',
]);

const databasesResponse = await fetch(`${base}/_all_dbs`, { headers });
if (!databasesResponse.ok) throw new Error(`Could not list CouchDB databases (${databasesResponse.status})`);
const databases = (await databasesResponse.json()).filter(name =>
  /^tamamhealth_(organizations|hospitals|users)(--|$)/.test(name));

const findings = [];
for (const database of databases) {
  const response = await fetch(`${base}/${encodeURIComponent(database)}/_all_docs?include_docs=true`, { headers });
  if (!response.ok) continue;
  const body = await response.json();
  for (const row of body.rows || []) {
    const doc = row.doc;
    if (!doc || doc._id?.startsWith('_design/')) continue;
    if (doc.dataOrigin === 'demo_seed' || knownLegacyIds.has(doc._id)) {
      findings.push({ database, id: doc._id, type: doc.type, name: doc.name || doc.username || null, tagged: doc.dataOrigin === 'demo_seed' });
    }
  }
}

console.log(JSON.stringify({ readOnly: true, findings, total: findings.length }, null, 2));
if (findings.length) process.exitCode = 1;
