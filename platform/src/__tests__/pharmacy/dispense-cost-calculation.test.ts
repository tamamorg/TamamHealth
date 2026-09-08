/**
 * Issue #85 pharmacy acceptance criteria: "Billing & dispensing:
 * auto-calculated cost, discounts/insurance, receipt generation."
 *
 * `integration/pharmacy-journey.test.ts` already proves the end-to-end wiring
 * (a prescription raises a charge the checkout gate can read), but nothing
 * pins the arithmetic itself at the unit level: quantity × unit price with
 * proper rounding, exact-service-code pricing beating a generic category
 * fallback, an uncatalogued line being skipped rather than charged zero, and
 * the insurance coinsurance/copay math that turns a gross charge into the
 * patient's actual responsibility. This is the "auto-calculated cost" and
 * "discounts/insurance" half of that bullet, isolated from the dispensing
 * workflow around it.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs } from '../helpers/test-db';
import { createFee, chargeForServices, priceFromFees } from '@/lib/services/fee-schedule-service';
import { createInsurancePolicy } from '@/lib/services/payment-service';
import type { FeeScheduleDoc } from '@/lib/db-types-billing';

const HOSP = 'hosp-001';
const ORG = 'org-moh-ss';
const PATIENT_ID = 'pat-00001';

const ctx = {
  patientId: PATIENT_ID,
  patientName: 'Nyakuma Deng',
  facilityId: HOSP,
  facilityName: 'Juba Teaching Hospital',
  facilityLevel: 'clinic',
  state: 'Central Equatoria',
  orgId: ORG,
  generatedBy: 'user-pharma-rose',
  generatedByName: 'Pharmacist Rose',
};

afterEach(async () => {
  await teardownTestDBs();
  uuidCounter = 0;
});

describe('priceFromFees — catalogue lookup', () => {
  const fees: FeeScheduleDoc[] = [
    { _id: 'f1', type: 'fee_schedule', facilityId: HOSP, facilityName: 'JTH', category: 'pharmacy', serviceCode: 'GENERIC-DISPENSE', serviceName: 'Generic dispensing fee', unitPrice: 500, currency: 'SSP', isActive: true, effectiveFrom: '', createdAt: '', updatedAt: '' },
    { _id: 'f2', type: 'fee_schedule', facilityId: HOSP, facilityName: 'JTH', category: 'pharmacy', serviceCode: 'Amoxicillin 500mg', serviceName: 'Amoxicillin 500mg', unitPrice: 50, currency: 'SSP', isActive: true, effectiveFrom: '', createdAt: '', updatedAt: '' },
  ];

  it('prefers an exact serviceCode match over the category\'s generic fee', () => {
    const fee = priceFromFees(fees, 'pharmacy', 'Amoxicillin 500mg');
    expect(fee?.unitPrice).toBe(50);
  });

  it('falls back to the first active fee in the category when the exact code is not catalogued', () => {
    const fee = priceFromFees(fees, 'pharmacy', 'Uncatalogued Drug');
    expect(fee?.unitPrice).toBe(500);
  });

  it('returns null when nothing is catalogued for the category at all', () => {
    expect(priceFromFees(fees, 'laboratory', undefined)).toBeNull();
  });
});

describe('chargeForServices — cost auto-calculation', () => {
  it('multiplies quantity by the catalogued unit price, rounded to the cent', async () => {
    await createFee({
      facilityId: HOSP, facilityName: 'JTH', category: 'pharmacy',
      serviceCode: 'Insulin (soluble/regular)', serviceName: 'Insulin (soluble/regular)',
      unitPrice: 333.335, orgId: ORG,
    });

    const bill = await chargeForServices(ctx, [{
      category: 'pharmacy', serviceCode: 'Insulin (soluble/regular)',
      quantity: 3, referenceId: 'rx-1', referenceType: 'prescription',
    }]);

    expect(bill).not.toBeNull();
    expect(bill!.items).toHaveLength(1);
    // 3 x 333.335 is 1000.005 in exact decimal, but 333.335 has no exact
    // binary representation, so the raw product floats to 1000.0049999999999.
    // The service must round that to a clean two-decimal money value.
    expect(bill!.items[0].totalPrice).toBe(1000);
    expect(bill!.subtotal).toBe(1000);
    expect(bill!.totalAmount).toBe(1000);
    expect(Number.isInteger(bill!.subtotal * 100)).toBe(true); // no float noise survives to storage
  });

  it('uses an explicit unitPrice override without touching the catalogue', async () => {
    const bill = await chargeForServices(ctx, [{
      category: 'pharmacy', description: 'Ad-hoc compounded item',
      quantity: 2, unitPrice: 75, referenceId: 'rx-2', referenceType: 'prescription',
    }]);
    expect(bill!.items[0].totalPrice).toBe(150);
    expect(bill!.items[0].description).toBe('Ad-hoc compounded item');
  });

  it('skips a line whose category has nothing catalogued at all, rather than charging zero', async () => {
    await createFee({
      facilityId: HOSP, facilityName: 'JTH', category: 'pharmacy',
      serviceCode: 'Amoxicillin 500mg', serviceName: 'Amoxicillin 500mg', unitPrice: 50, orgId: ORG,
    });
    // No 'laboratory' fee exists anywhere in the catalogue, so this line has nothing
    // to fall back to — unlike an unrecognised code within a priced category
    // (priceFromFees's documented category fallback), which is covered above.

    const bill = await chargeForServices(ctx, [
      { category: 'pharmacy', serviceCode: 'Amoxicillin 500mg', quantity: 10 },
      { category: 'laboratory', serviceCode: 'Uncatalogued Lab Test', quantity: 1 },
    ]);

    expect(bill!.items).toHaveLength(1);
    expect(bill!.items[0].category).toBe('pharmacy');
    expect(bill!.totalAmount).toBe(500); // 50 * 10, the uncatalogued lab line contributes nothing
  });

  it('creates no bill at all when every line is unpriced', async () => {
    const bill = await chargeForServices(ctx, [
      { category: 'laboratory', serviceCode: 'Nothing Catalogued', quantity: 1 },
    ]);
    expect(bill).toBeNull();
  });

  it('applies the patient\'s active insurance coinsurance/copay to compute the covered percentage', async () => {
    await createFee({
      facilityId: HOSP, facilityName: 'JTH', category: 'pharmacy',
      serviceCode: 'Amoxicillin 500mg', serviceName: 'Amoxicillin 500mg', unitPrice: 100, orgId: ORG,
    });
    await createInsurancePolicy({
      patientId: PATIENT_ID, payerType: 'private', payerName: 'Nile Assurance',
      effectiveDate: '2020-01-01', isPrimary: true,
      coinsurancePct: 20, // patient carries 20% coinsurance
      copayAmount: 50,
      facilityId: HOSP, orgId: ORG,
    });

    const bill = await chargeForServices(ctx, [
      { category: 'pharmacy', serviceCode: 'Amoxicillin 500mg', quantity: 10 }, // subtotal 1000
    ]);

    expect(bill!.subtotal).toBe(1000);
    expect(bill!.insuranceProvider).toBe('Nile Assurance');
    // coverageFraction = (100-20)/100 = 0.8; insurancePays = 1000*0.8 - 50 = 750
    // insuranceCoveragePercent = 750/1000 * 100 = 75
    expect(bill!.insuranceCoveragePercent).toBe(75);
    expect(bill!.amountPaid).toBe(750);
    expect(bill!.balanceDue).toBe(250);
  });

  it('bills as cash (no insurance fields) when the patient has no active policy', async () => {
    await createFee({
      facilityId: HOSP, facilityName: 'JTH', category: 'pharmacy',
      serviceCode: 'Amoxicillin 500mg', serviceName: 'Amoxicillin 500mg', unitPrice: 100, orgId: ORG,
    });

    const bill = await chargeForServices(ctx, [
      { category: 'pharmacy', serviceCode: 'Amoxicillin 500mg', quantity: 2 },
    ]);
    expect(bill!.insuranceProvider).toBeUndefined();
    expect(bill!.amountPaid).toBe(0);
    expect(bill!.balanceDue).toBe(200);
  });
});
