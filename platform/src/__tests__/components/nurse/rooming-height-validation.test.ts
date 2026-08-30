/**
 * RoomingWorkflow's height field was missing a `rangeKey`, so the vitals
 * validation loop (`saveVitals`, which checks `field.rangeKey &&
 * !isVitalInRange(field.rangeKey, value)` for every VITAL_FIELDS entry)
 * silently skipped height — a nurse could save "9999" cm and it would be
 * accepted and persisted with no warning, even though `VITAL_RANGES.height`
 * already exists and every other numeric field in the same list is checked.
 *
 * A lightweight source check (matching `triage-workflow-completion.test.ts`'s
 * convention) rather than a full component render: the fix is a one-line
 * config entry, and `isVitalInRange('height', ...)` itself is already
 * covered by the shared vitals test suite.
 */
import fs from 'node:fs';
import path from 'node:path';
import { VITAL_RANGES } from '@/lib/clinical/vitals';

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/components/nurse/RoomingWorkflow.tsx'),
  'utf8',
);

test('the height row declares rangeKey: \'height\' so it is validated like every other numeric vital', () => {
  const heightRow = source.match(/\{ key: 'height'[^}]*\}/)?.[0];
  expect(heightRow).toBeDefined();
  expect(heightRow).toContain("rangeKey: 'height'");
});

test('VITAL_RANGES.height still exists — the row is pointing at a real range', () => {
  expect(VITAL_RANGES.height).toEqual([30, 250]);
});
