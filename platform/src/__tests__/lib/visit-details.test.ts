import {
  ON_TIME_WINDOW_MIN, cleanVisitBilling, derivePunctuality, visitBillingComplete,
} from '@/lib/visits/visit-details';

describe('derivePunctuality — booked time vs the Juba clock', () => {
  it(`counts ${ON_TIME_WINDOW_MIN} minutes either side as on time`, () => {
    expect(derivePunctuality('10:00', '09:45')).toBe('on_time');
    expect(derivePunctuality('10:00', '10:15')).toBe('on_time');
  });
  it('is early or late outside the window', () => {
    expect(derivePunctuality('10:00', '09:44')).toBe('early');
    expect(derivePunctuality('10:00', '10:16')).toBe('late');
  });
  it('suggests nothing for a booking with no usable time', () => {
    expect(derivePunctuality('', '10:00')).toBeUndefined();
    expect(derivePunctuality('soon', '10:00')).toBeUndefined();
  });
});

describe('visitBillingComplete — Start visit stays disabled until billing is answered', () => {
  it('needs a choice', () => {
    expect(visitBillingComplete({})).toBe(false);
  });
  it('paying needs a method, and insurance needs its scheme (the policy number is optional)', () => {
    expect(visitBillingComplete({ payment: 'paying' })).toBe(false);
    expect(visitBillingComplete({ payment: 'paying', method: 'cash' })).toBe(true);
    expect(visitBillingComplete({ payment: 'paying', method: 'insurance' })).toBe(false);
    expect(visitBillingComplete({ payment: 'paying', method: 'insurance', insuranceScheme: 'CBHI' })).toBe(true);
  });
  it('non-paying needs an exemption, and "other" needs its reason', () => {
    expect(visitBillingComplete({ payment: 'non_paying' })).toBe(false);
    expect(visitBillingComplete({ payment: 'non_paying', exemption: 'under_five' })).toBe(true);
    expect(visitBillingComplete({ payment: 'non_paying', exemption: 'other' })).toBe(false);
    expect(visitBillingComplete({ payment: 'non_paying', exemption: 'other', exemptionReason: 'Chief\'s letter' })).toBe(true);
  });
});

describe('cleanVisitBilling — only the answers that apply are written', () => {
  it('drops insurance details from a cash payer and the reason from a named exemption', () => {
    expect(cleanVisitBilling({ payment: 'paying', method: 'cash', insuranceScheme: 'CBHI', policyNumber: 'X1' }))
      .toEqual({ payment: 'paying', method: 'cash', insuranceScheme: undefined, policyNumber: undefined });
    expect(cleanVisitBilling({ payment: 'non_paying', exemption: 'maternal', exemptionReason: 'left over', method: 'cash' }))
      .toEqual({ payment: 'non_paying', exemption: 'maternal', exemptionReason: undefined });
  });
  it('keeps the insurer and trimmed policy number for an insured payer', () => {
    expect(cleanVisitBilling({ payment: 'paying', method: 'insurance', insuranceScheme: ' CBHI ', policyNumber: ' P-77 ' }))
      .toEqual({ payment: 'paying', method: 'insurance', insuranceScheme: 'CBHI', policyNumber: 'P-77' });
  });
  it('writes nothing when billing was never answered', () => {
    expect(cleanVisitBilling({})).toBeUndefined();
  });
});
