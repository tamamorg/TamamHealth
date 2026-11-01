import { describeTransferRoute } from '@/lib/services/patient-transfer-service';

const juba = { facilityId: 'hosp-001', facilityName: 'Juba Teaching Hospital' };
const wau = { facilityId: 'hosp-002', facilityName: 'Wau State Hospital' };

describe('describeTransferRoute', () => {
  describe('between hospitals', () => {
    const transfer = {
      hospitalId: 'hosp-001',
      from: { ...juba, providerId: 'u1', providerName: 'Dr. A' },
      to: { ...wau, providerId: 'u2', providerName: 'Dr. B' },
    };

    it('tells the sending hospital where the patient went', () => {
      expect(describeTransferRoute(transfer, { id: 'u1', hospitalId: 'hosp-001' }))
        .toBe('To Dr. B · Wau State Hospital');
    });

    it('tells the receiving hospital where the patient came from', () => {
      expect(describeTransferRoute(transfer, { id: 'u9', hospitalId: 'hosp-002' }))
        .toBe('From Dr. A · Juba Teaching Hospital');
    });

    it('reads from the sending side with no viewer', () => {
      expect(describeTransferRoute(transfer)).toBe('To Dr. B · Wau State Hospital');
    });
  });

  describe('within one hospital', () => {
    const transfer = {
      hospitalId: 'hosp-001',
      from: { ...juba, providerId: 'u1', providerName: 'Dr. A', department: 'Medicine' },
      to: { ...juba, providerId: 'u2', providerName: 'Dr. B', department: 'Surgery' },
    };

    it('never names the hospital', () => {
      expect(describeTransferRoute(transfer, { id: 'u1', hospitalId: 'hosp-001' })).toBe('To Dr. B · Surgery');
      expect(describeTransferRoute(transfer)).toBe('To Dr. B · Surgery');
    });

    it('shows the receiver who sent it', () => {
      expect(describeTransferRoute(transfer, { id: 'u2', hospitalId: 'hosp-001' })).toBe('From Dr. A · Medicine');
    });
  });
});

it('takes its words from the caller, so a screen can translate them', () => {
  const transfer = { hospitalId: 'hosp-001', from: { facilityId: 'hosp-001' }, to: { facilityId: 'hosp-002', facilityName: 'Wau State Hospital' } };
  expect(describeTransferRoute(transfer, { hospitalId: 'hosp-001' }, { to: 'إلى', from: 'من' })).toBe('إلى Wau State Hospital');
});
