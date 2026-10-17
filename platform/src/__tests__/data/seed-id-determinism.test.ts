/**
 * The demo seed's document ids must be the same on every device.
 *
 * Seed prescriptions are written as `rx-${patientId}-${visit}-${k}`, where k
 * runs over the prescriptions `generateMedicalRecords` drew for that visit.
 * Those draws used to come from one module-level PRNG stream, so the ids
 * depended on how many draws the process had already made. Each fresh browser
 * profile therefore planted a different id set into the shared store and the
 * pharmacy queue kept growing (273 -> 279 -> 298 -> 317).
 */
import { generateMedicalRecords, patients } from '@/data/mock';

function seedPrescriptionIds(): string[] {
  const ids: string[] = [];
  for (const p of patients.slice(0, 40)) {
    generateMedicalRecords(p.id, 6).forEach((record, ri) => {
      record.prescriptions.forEach((_, k) => ids.push(`rx-${p.id}-${ri}-${k}`));
    });
  }
  return ids;
}

describe('generateMedicalRecords determinism', () => {
  it('yields the same prescription ids on every pass in one process', () => {
    const first = seedPrescriptionIds();
    const second = seedPrescriptionIds();
    const third = seedPrescriptionIds();
    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it('does not depend on what other callers drew before it', () => {
    const target = patients[3];
    const alone = generateMedicalRecords(target.id, 6);
    // Burn stream state through unrelated calls, as a second seed pass or a
    // portal-demo lookup would.
    for (const p of patients.slice(10, 20)) generateMedicalRecords(p.id, 6);
    const afterOthers = generateMedicalRecords(target.id, 6);
    expect(afterOthers.map(r => r.prescriptions.length)).toEqual(alone.map(r => r.prescriptions.length));
    expect(afterOthers.map(r => r.vitalSigns.systolic)).toEqual(alone.map(r => r.vitalSigns.systolic));
    expect(afterOthers.map(r => r.diagnoses)).toEqual(alone.map(r => r.diagnoses));
  });
});
