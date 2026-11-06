/**
 * @jest-environment node
 *
 * Every emitSyncEvent() call must pass orgId.
 *
 * The sync-outbox push filter drops any sync_event whose orgId is unset, so a
 * call that omits it silently loses the country-node / analytics event — the
 * clinical record still syncs, but the national stream misses it. Seven call
 * sites (prescription create/update, dispense, bed transfer, the two portal
 * appointment writes, portal payment) shipped without orgId and were invisible
 * until the 2026-11-05 data audit (§2.2). This guard stops any new one.
 *
 * It scans source rather than exercising each service because the sites span
 * five files behind heavy safety/DB machinery; the invariant is purely "the
 * field is present in the call", which the text carries exactly.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Return each emitSyncEvent({ ... }) call's argument text. Scans brace depth
 * from the opening `{` so both single-line and multi-line calls are captured.
 */
function emitSyncEventCalls(source: string): string[] {
  const calls: string[] = [];
  const marker = 'emitSyncEvent(';
  let idx = source.indexOf(marker);
  while (idx !== -1) {
    const open = source.indexOf('{', idx);
    // Defensive: a call that isn't emitSyncEvent({...}) (none today) is skipped.
    if (open !== -1 && open < source.indexOf(')', idx)) {
      let depth = 0;
      let end = open;
      for (; end < source.length; end++) {
        if (source[end] === '{') depth++;
        else if (source[end] === '}') { depth--; if (depth === 0) break; }
      }
      calls.push(source.slice(open, end + 1));
    }
    idx = source.indexOf(marker, idx + marker.length);
  }
  return calls;
}

describe('emitSyncEvent orgId coverage', () => {
  it('every emitSyncEvent call passes orgId', () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const source = fs.readFileSync(file, 'utf8');
      // Skip the definition/forwarders in the service itself.
      if (file.endsWith(path.join('services', 'sync-event-service.ts'))) continue;
      for (const call of emitSyncEventCalls(source)) {
        if (!/\borgId\b/.test(call)) {
          offenders.push(`${path.relative(ROOT, file)}: ${call.replace(/\s+/g, ' ').slice(0, 120)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
