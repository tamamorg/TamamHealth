/**
 * The national analytics copy holds no readable identifier or clinical text.
 * Identifiers it must still match on become keyed fingerprints; the rest is
 * ciphertext; codes and counts the dashboards aggregate on stay readable.
 */
jest.mock('@/modules/identity', () => ({ logApiError: jest.fn() }));
jest.mock('@/lib/db/postgres', () => ({ query: jest.fn(), upsertDocument: jest.fn(), deleteDocument: jest.fn(), ConflictPolicy: {}, TABLE_CONFLICT_POLICY: {} }));
jest.mock('@/lib/encrypted-db', () => ({ decryptDocument: jest.fn(async (doc: unknown) => doc) }));
jest.mock('@/lib/sync-auth', () => ({ verifySyncMachineRequest: jest.fn(async () => ({ ok: true })) }));
jest.mock('@/lib/org-data-cipher', () => ({
  blindIndex: jest.fn(async (value: string) => `blind:${value}`),
  encryptForOrg: jest.fn(async (value: string) => `sealed:${value}`),
}));

import { sealIdentifyingColumns } from '@/modules/analytics/api/sync-route';

describe('sealIdentifyingColumns', () => {
  test('a patient row keeps no readable identifier', async () => {
    const row: Record<string, unknown> = {
      name: 'Ayen Deng', date_of_birth: '1990-02-03', age: 36, gender: 'female', state: 'Central Equatoria',
      hospital_number: 'JTH-0001', household_number: 'HH-77', geocode_id: 'SS-CE-123', national_id: 'A123',
    };
    await sealIdentifyingColumns('patients', row, 'org-a');
    expect(row).toMatchObject({
      name: 'sealed:Ayen Deng', date_of_birth: 'sealed:1990-02-03',
      hospital_number: 'blind:JTH-0001', household_number: 'blind:HH-77', geocode_id: 'blind:SS-CE-123', national_id: 'blind:A123',
      age: 36, gender: 'female', state: 'Central Equatoria',
    });
  });

  test('clinical text is sealed, its code is not', async () => {
    const record: Record<string, unknown> = { diagnosis: 'Severe malaria', icd11_code: '1F40', severity: 'severe' };
    await sealIdentifyingColumns('medical_records', record, 'org-a');
    expect(record).toEqual({ diagnosis: 'sealed:Severe malaria', icd11_code: '1F40', severity: 'severe' });

    const admission: Record<string, unknown> = { admitting_diagnosis: 'x', discharge_diagnosis: 'y', isolation_reason: 'z', discharge_icd11: '1F40' };
    await sealIdentifyingColumns('admissions', admission, 'org-a');
    expect(admission).toEqual({ admitting_diagnosis: 'sealed:x', discharge_diagnosis: 'sealed:y', isolation_reason: 'sealed:z', discharge_icd11: '1F40' });
  });

  test('a column name is only sealed in the table where it is clinical', async () => {
    const asset: Record<string, unknown> = { condition: 'needs repair' };
    await sealIdentifyingColumns('assets', asset, 'org-a');
    expect(asset.condition).toBe('needs repair');
  });

  test('births and deaths keep only the month, which is all the monthly views use', async () => {
    const birth: Record<string, unknown> = { date_of_birth: '2026-01-02', mother_name: 'Amina' };
    await sealIdentifyingColumns('births', birth, 'org-a');
    expect(birth).toEqual({ date_of_birth: '2026-01-01', mother_name: 'sealed:Amina' });

    const death: Record<string, unknown> = { date_of_birth: '1950-06-07', date_of_death: '2026-03-17', age_at_death: 75 };
    await sealIdentifyingColumns('deaths', death, 'org-a');
    expect(death).toEqual({ date_of_birth: null, date_of_death: '2026-03-01', age_at_death: 75 });
  });
});
