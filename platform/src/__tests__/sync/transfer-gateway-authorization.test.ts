import { authorizeReplicatedTransfer } from '@/lib/sync/transfer-gateway-authorization';
import type { PatientDoc, PatientTransferDoc } from '@/lib/db-types';
import type { AuthPayload } from '@/modules/identity';

const auth = {
  sub: 'doctor-1', username: 'doctor.one', name: 'Doctor One', role: 'doctor',
  orgId: 'org-1', hospitalId: 'hospital-1',
} as AuthPayload;

const patient = {
  _id: 'patient-1', type: 'patient', orgId: 'org-1',
  assignedDoctor: 'doctor-1', careTeam: [],
} as unknown as PatientDoc;

function transfer(overrides: Partial<PatientTransferDoc> = {}): PatientTransferDoc {
  return {
    _id: 'transfer-1', type: 'patient_transfer', patientId: 'patient-1', orgId: 'org-1',
    status: 'requested', requestedById: 'doctor-1',
    from: { providerId: 'doctor-1', facilityId: 'hospital-1' },
    to: { providerId: 'doctor-2', facilityId: 'hospital-1' },
    events: [],
    ...overrides,
  } as PatientTransferDoc;
}

describe('transfer replication relationship authorization', () => {
  it('allows a care-team member to replicate their request', () => {
    expect(authorizeReplicatedTransfer(auth, transfer(), null, patient)).toBeNull();
  });

  it('rejects requester impersonation', () => {
    expect(authorizeReplicatedTransfer(auth, transfer({ requestedById: 'doctor-9' }), null, patient))
      .toMatch(/impersonate/);
  });

  it('rejects missing requester and organization identity', () => {
    expect(authorizeReplicatedTransfer(auth, transfer({ requestedById: undefined }), null, patient))
      .toMatch(/impersonate/);
    expect(authorizeReplicatedTransfer(auth, transfer({ orgId: undefined }), null, patient))
      .toMatch(/outside your organization/);
  });

  it('rejects destructive history rewrites', () => {
    const previous = transfer({ events: [{ id: 'event-1', kind: 'TRANSFER_REQUESTED', message: 'Requested', createdAt: '2026-01-01' }] });
    expect(authorizeReplicatedTransfer(auth, transfer({ events: [] }), previous, patient))
      .toMatch(/append-only/);
  });
});
