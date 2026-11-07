/**
 * Receiving stock must mark controlled medicines so the dispensing witness gate
 * (already enforced for a batch with controlledSchedule/requiresWitness) fires.
 * The headline gap in the 2026-11-05 security audit (§2.1 #7) was that morphine
 * stocked through the UI dispensed with no witness — nothing set the flag.
 */
import { stockRequiresWitness } from '@/components/pharmacy/pharmacy-helpers';

describe('stockRequiresWitness', () => {
  it('is true when the pharmacist assigned any schedule', () => {
    expect(stockRequiresWitness('Paracetamol 500mg', 'V')).toBe(true);
    expect(stockRequiresWitness('Amoxicillin', 'III')).toBe(true);
  });

  it('is true for a recognised controlled medicine even with no schedule picked', () => {
    // The safety net: a narcotic typed into the form with the schedule left blank.
    expect(stockRequiresWitness('Morphine sulfate 10mg', '')).toBe(true);
    expect(stockRequiresWitness('Diazepam 5mg', '')).toBe(true);
    expect(stockRequiresWitness('Paracetamol + Codeine', '')).toBe(true);
  });

  it('is false for an ordinary medicine with no schedule', () => {
    expect(stockRequiresWitness('Paracetamol 500mg', '')).toBe(false);
    expect(stockRequiresWitness('Amoxicillin 500mg', '')).toBe(false);
    expect(stockRequiresWitness('', '')).toBe(false);
  });
});
