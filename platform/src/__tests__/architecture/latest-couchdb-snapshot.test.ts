/** @jest-environment node
 *
 * A backup tarball holds up to 14 days of snapshots. Replaying them all fails
 * on the second, which kept the weekly drill red and would have stopped a real
 * recovery, so the restore is pointed at one snapshot.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repo = path.resolve(__dirname, '../../../..');
const script = path.join(repo, 'scripts/latest-couchdb-snapshot.sh');

describe('latest-couchdb-snapshot', () => {
  let volume: string;

  const snapshot = (name: string, ...files: string[]) => {
    mkdirSync(path.join(volume, name));
    for (const file of ['tamamhealth_patients.json.gz', ...files]) writeFileSync(path.join(volume, name, file), '');
    writeFileSync(path.join(volume, name, 'manifest.json'), '{"databases":[],"failures":0}\n');
  };
  const pick = () => spawnSync('bash', [script, volume], { encoding: 'utf8' });

  beforeEach(() => { volume = mkdtempSync(path.join(tmpdir(), 'couch-volume-')); });
  afterEach(() => rmSync(volume, { recursive: true, force: true }));

  test('picks the newest of several snapshots', () => {
    snapshot('20261030T021500Z');
    snapshot('20261031T021500Z');
    expect(pick().stdout.trim()).toBe(path.join(volume, '20261031T021500Z'));
  });

  test('passes over a snapshot that failed to verify', () => {
    snapshot('20261030T021500Z');
    snapshot('20261031T021500Z', '.INCOMPLETE');
    const result = pick();
    expect(result.stdout.trim()).toBe(path.join(volume, '20261030T021500Z'));
    expect(result.stderr).toContain('skipping incomplete snapshot 20261031T021500Z');
  });

  test('passes over an empty directory and anything that is not a snapshot', () => {
    snapshot('20261030T021500Z');
    mkdirSync(path.join(volume, '20261031T021500Z'));
    mkdirSync(path.join(volume, 'lost+found'));
    expect(pick().stdout.trim()).toBe(path.join(volume, '20261030T021500Z'));
  });

  test('passes over a dump that was killed before its manifest closed', () => {
    snapshot('20261030T021500Z');
    snapshot('20261031T021500Z');
    writeFileSync(path.join(volume, '20261031T021500Z', 'manifest.json'), '{"databases":[');
    expect(pick().stdout.trim()).toBe(path.join(volume, '20261030T021500Z'));
  });

  test('passes over a dump that recorded failures', () => {
    snapshot('20261030T021500Z');
    snapshot('20261031T021500Z');
    writeFileSync(path.join(volume, '20261031T021500Z', 'manifest.json'), '{"databases":[],"failures":2}\n');
    expect(pick().stdout.trim()).toBe(path.join(volume, '20261030T021500Z'));
  });

  test('passes over a dump holding only system databases', () => {
    snapshot('20261030T021500Z');
    mkdirSync(path.join(volume, '20261031T021500Z'));
    writeFileSync(path.join(volume, '20261031T021500Z', '_users.json.gz'), '');
    writeFileSync(path.join(volume, '20261031T021500Z', 'manifest.json'), '{"databases":[],"failures":0}\n');
    expect(pick().stdout.trim()).toBe(path.join(volume, '20261030T021500Z'));
  });

  test('passes over a directory whose name is not a full dump stamp', () => {
    snapshot('20261030T021500Z');
    snapshot('20261031T0215Z');
    expect(pick().stdout.trim()).toBe(path.join(volume, '20261030T021500Z'));
  });

  test('fails when no snapshot can be restored', () => {
    snapshot('20261031T021500Z', '.INCOMPLETE');
    expect(pick().status).toBe(1);
  });
});
