/**
 * scripts/repair-prescription-facility.mjs gives facility-less prescriptions
 * back their facility. Prescriptions written from a chart note before
 * 2026-10-29 carried no hospitalId, which the scope filter reads as
 * organisation-wide. Each one is placed from its encounter first, then from its
 * patient's facility; one it cannot place is left alone.
 */
import { execFileSync } from 'child_process';
import path from 'path';

const script = path.resolve(__dirname, '../../../scripts/repair-prescription-facility.mjs');

function run(body: string): unknown {
  const program = `
    const m = await import(${JSON.stringify('file://' + script)});
    const encounters = new Map([['enc-1', 'hosp-001']]);
    const patients = new Map([['pat-1', 'hosp-002'], ['pat-2', 'hosp-003']]);
    ${body}
  `;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', program]).toString());
}

test('takes the encounter facility first', () => {
  expect(run(`process.stdout.write(JSON.stringify(m.facilityFor({ encounterId: 'enc-1', patientId: 'pat-1' }, { encounters, patients })));`)).toBe('hosp-001');
});

test('falls back to the patient facility when the encounter is unknown', () => {
  expect(run(`process.stdout.write(JSON.stringify(m.facilityFor({ encounterId: 'enc-x', patientId: 'pat-2' }, { encounters, patients })));`)).toBe('hosp-003');
});

test('leaves a prescription it cannot place', () => {
  expect(run(`process.stdout.write(JSON.stringify(m.facilityFor({ patientId: 'pat-x' }, { encounters, patients })));`)).toBeNull();
});
