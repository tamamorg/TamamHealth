/**
 * Registration warns about a likely duplicate the exact-match check misses.
 * The name/DOB and identifier rules in createPatient refuse an exact repeat;
 * this covers a differently spelled name with the same date of birth or phone.
 * It only warns: nothing here blocks a registration.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-mpuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

jest.setTimeout(30000);

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { patientsDB } from '@/lib/db';
import { findMpiDuplicates } from '@/lib/services/patient-service';

const SCOPE = { role: 'super_admin' } as const;

beforeEach(async () => {
  await putDoc(patientsDB(), {
    _id: 'pat-1', type: 'patient', firstName: 'Nyandeng', surname: 'Mayen', dateOfBirth: '1990-04-02',
    phone: '+211912345678', hospitalNumber: 'H-1', orgId: 'org-a', registrationHospital: 'h-1',
  } as never);
  await putDoc(patientsDB(), {
    _id: 'pat-2', type: 'patient', firstName: 'Achol', surname: 'Garang', dateOfBirth: '1985-01-01',
    phone: '+211900000000', hospitalNumber: 'H-2', orgId: 'org-a', registrationHospital: 'h-1',
  } as never);
});
afterEach(async () => { await teardownTestDBs(); uuidCounter = 0; });

describe('findMpiDuplicates', () => {
  it('flags a respelled name with the same date of birth', async () => {
    const hits = await findMpiDuplicates({ firstName: 'Nyandeeng', surname: 'Mayen', dateOfBirth: '1990-04-02' }, SCOPE);
    expect(hits.map(h => h.patient._id)).toEqual(['pat-1']);
  });

  it('does not flag a similar name with nothing else in common', async () => {
    const hits = await findMpiDuplicates({ firstName: 'Nyandeeng', surname: 'Mayen', dateOfBirth: '2001-09-09' }, SCOPE);
    expect(hits).toEqual([]);
  });

  it('does not flag a stranger', async () => {
    expect(await findMpiDuplicates({ firstName: 'Kuol', surname: 'Deng', dateOfBirth: '1970-01-01' }, SCOPE)).toEqual([]);
  });

  it('reveals nothing outside the caller scope', async () => {
    const other = { role: 'doctor', orgId: 'org-b', hospitalId: 'h-9' } as never;
    const hits = await findMpiDuplicates({ firstName: 'Nyandeeng', surname: 'Mayen', dateOfBirth: '1990-04-02' }, other);
    expect(hits).toEqual([]);
  });
});
