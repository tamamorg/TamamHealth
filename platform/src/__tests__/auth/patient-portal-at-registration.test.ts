/**
 * A patient's portal account is opened BY registration.
 *
 * It used to be a second errand — open the chart, find Demographics, enrol,
 * copy a 43-character code — so patients left the desk without one. The
 * account is now part of the patient write: the registering device mints the
 * code, stores only its hash on the new document, and hands the slip over
 * before the patient walks away. These tests pin that the slip a clerk prints
 * at registration actually opens the account, typed the way a person types.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { createPatient } from '@/lib/services/patient-service';
import { hospitalsDB, patientsDB } from '@/lib/db';
import type { PatientDoc } from '@/lib/db-types';
import type { DataScope } from '@/lib/services/data-scope';
import {
  mintPortalInvite, formatPortalActivationCode, generatePortalActivationCode,
  hashPortalActivationCode, isPortalActivationCode, normalisePortalActivationCode,
  uniquePortalUsername, PORTAL_INVITE_TTL_HOURS,
} from '@/modules/identity/provisioning/portal-invite';
import { hashInviteToken, INVITE_TTL_HOURS } from '@/modules/identity/provisioning/user-invite';
import {
  activatePortalAccount, enrolPatientInPortal, summarisePortalAccess,
} from '@/modules/identity/services/patient-portal-enrolment';
import { verifyPassword } from '@/modules/identity/core/auth';

// jsdom ships `crypto.getRandomValues` but not always `subtle`; a real browser
// on https has both, which is what this stands in for.
if (!globalThis.crypto?.subtle) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Object.defineProperty(globalThis, 'crypto', { value: require('node:crypto').webcrypto, configurable: true });
}

const ORG = 'org-moh-ss';
const HOSP = 'hosp-001';
const DESK: DataScope = { orgId: ORG, hospitalId: HOSP, role: 'front_desk' };

beforeEach(async () => {
  await putDoc(hospitalsDB(), {
    _id: HOSP, type: 'hospital', name: 'Juba Teaching Hospital', code: 'JTH', orgId: ORG,
  } as unknown as { _id: string });
});
afterEach(async () => { await teardownTestDBs(); uuidCounter = 0; });

function registration(overrides: Partial<PatientDoc> = {}) {
  return {
    hospitalNumber: '', firstName: 'Mary', middleName: '', surname: 'Lado', maidenName: '',
    dateOfBirth: '1990-01-01', gender: 'Female', tribe: '', primaryLanguage: 'English',
    phone: '', altPhone: '', whatsapp: '', state: 'Central Equatoria', county: 'Juba',
    payam: '', boma: '', address: '', nokName: 'John Lado', nokRelationship: 'Spouse',
    nokPhone: '+211912345678', nokAddress: '', bloodType: 'Unknown', allergies: ['None known'],
    chronicConditions: ['None'], registrationHospital: HOSP, registrationDate: '2026-10-08',
    lastVisitDate: '2026-10-08', lastVisitHospital: HOSP, isActive: true,
    ...overrides,
  } as unknown as Parameters<typeof createPatient>[0];
}

const stored = async (id: string) => await patientsDB().get(id) as PatientDoc;

describe('the desk code', () => {
  it('is sixteen unambiguous characters, printed in four groups', () => {
    const code = generatePortalActivationCode();
    expect(isPortalActivationCode(code)).toBe(true);
    expect(code).not.toMatch(/[01IO]/);
    expect(formatPortalActivationCode(code)).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  });

  it('hashes the same in a browser as on the server, however it was typed', async () => {
    const code = generatePortalActivationCode();
    const sloppy = ` ${formatPortalActivationCode(code).toLowerCase().replace(/-/g, ' ')} `;
    expect(normalisePortalActivationCode(sloppy)).toBe(code);
    // Web Crypto here, node:crypto in the enrolment service — one stored value.
    expect(await hashPortalActivationCode(sloppy)).toBe(hashInviteToken(code));
  });

  it('outlives a staff invitation — the patient is not at a desk', () => {
    expect(PORTAL_INVITE_TTL_HOURS).toBeGreaterThan(INVITE_TTL_HOURS);
  });

  it('picks the first username nobody holds', () => {
    expect(uniquePortalUsername('mary.lado.0001', new Set())).toBe('mary.lado.0001');
    expect(uniquePortalUsername('mary.lado.0001', new Set(['mary.lado.0001', 'mary.lado.0001-2'])))
      .toBe('mary.lado.0001-3');
  });
});

describe('registering with a portal account', () => {
  it('writes the account with the patient, and never the code', async () => {
    const invite = (await mintPortalInvite())!;
    const patient = await createPatient(registration(), DESK, {
      portalInvite: { tokenHash: invite.tokenHash, expiresAt: invite.expiresAt, enabledBy: 'desk.amira' },
    });

    const doc = await stored(patient._id);
    expect(doc.portalUsername).toMatch(/^mary\.lado\.\d+$/);
    expect(doc.portalEnabledBy).toBe('desk.amira');
    expect(doc.portalInviteTokenHash).toBe(invite.tokenHash);
    expect(JSON.stringify(doc)).not.toContain(normalisePortalActivationCode(invite.code));
    expect(summarisePortalAccess(doc)).toMatchObject({ enrolled: true, activated: false, activationPending: true });
  });

  it('leaves a patient registered without one untouched', async () => {
    const patient = await createPatient(registration(), DESK);
    const doc = await stored(patient._id);
    expect(doc.portalUsername).toBeUndefined();
    expect(doc.portalInviteTokenHash).toBeUndefined();
  });

  it('the slip opens the account — typed lower-case, without the dashes', async () => {
    const invite = (await mintPortalInvite())!;
    const patient = await createPatient(registration(), DESK, {
      portalInvite: { tokenHash: invite.tokenHash, expiresAt: invite.expiresAt },
    });

    const typed = invite.code.toLowerCase().replace(/-/g, '');
    expect(await activatePortalAccount(typed, 'a-good-password'))
      .toMatchObject({ ok: true, username: patient.portalUsername });
    const doc = await stored(patient._id);
    expect(await verifyPassword('a-good-password', doc.portalPasswordHash!)).toBe(true);
    // Single-use.
    expect(doc.portalInviteTokenHash).toBeUndefined();
    expect(await activatePortalAccount(invite.code, 'another-password')).toMatchObject({ ok: false });
  });

  it('does not hand two patients the same username', async () => {
    await putDoc(patientsDB(), {
      _id: 'pat-existing', type: 'patient', orgId: ORG, registrationHospital: HOSP,
      firstName: 'Mary', surname: 'Lado', dateOfBirth: '1960-05-05', hospitalNumber: 'JTH-2019-0042',
      portalUsername: 'mary.lado.0042', isActive: true,
    } as unknown as { _id: string });

    const patient = await createPatient(registration({ hospitalNumber: 'JTH-2026-0042' }), DESK, {
      portalInvite: { tokenHash: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00.000Z' },
    });
    expect(patient.portalUsername).toBe('mary.lado.0042-2');
  });
});

describe('re-issuing from the chart', () => {
  it('hands out the same kind of code as registration', async () => {
    const patient = await createPatient(registration(), DESK);
    const result = await enrolPatientInPortal(patient._id, 'mary.lado', 'desk.amira');
    if (!result.ok) throw new Error('enrol failed');
    expect(result.enrolment.activationCode).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    expect(await activatePortalAccount(result.enrolment.activationCode, 'a-good-password'))
      .toMatchObject({ ok: true, username: 'mary.lado' });
  });
});
