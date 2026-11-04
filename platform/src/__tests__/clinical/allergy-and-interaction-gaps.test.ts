/**
 * Gaps a review found: real allergies read as "none", brand and British names
 * that no rule matched, and medicines with no end date falling off the list.
 */
import { isNoAllergySentinel } from '@/lib/clinical-roles';
import {
  checkAllergies, checkAllergiesStructured, checkNewPrescription,
} from '@/lib/services/drug-interaction-service';
import { hasSafetyStop, needsWeeklyReview, unreviewedInteractionConflicts } from '@/lib/pharmacy/rx-safety';
import { isMedicationCurrent, ONGOING_COURSE_LOOKBACK_DAYS } from '@/lib/services/prescription-service';

describe('no-allergy markers', () => {
  it.each(['None', 'none known', 'NKDA', 'NKDA.', 'No known allergies', 'no known drug allergies', 'Nil', 'n/a', 'NA', 'Unknown', ''])(
    '%j means nothing recorded',
    value => expect(isNoAllergySentinel(value)).toBe(true),
  );

  it.each(['Naproxen', 'Nafcillin', 'Nalidixic acid', 'Natural rubber latex', 'Nilotinib', 'Nitrofurantoin', 'Unknown tablets'])(
    '%s is a real allergy',
    value => expect(isNoAllergySentinel(value)).toBe(false),
  );

  it('raises a recorded naproxen allergy', () => {
    expect(checkAllergies(['Naproxen'], ['Naproxen'])).toHaveLength(1);
    expect(checkAllergiesStructured(['Ibuprofen'], [{ substance: 'Naproxen', criticality: 'severe' }])[0].requiresOverride).toBe(true);
  });
});

describe('interaction names', () => {
  it.each(['Co-trimoxazole', 'Septrin', 'Bactrim', 'Sulfamethoxazole-Trimethoprim', 'Trimethoprim/Sulfamethoxazole'])(
    // The US labels say avoid, not contraindicated, for both of these pairs.
    'warns about methotrexate with %s',
    name => expect(checkNewPrescription(name, ['Methotrexate']).highestSeverity).toBe('serious'),
  );

  it.each(['Coartem', 'Artemether Lumefantrine', 'Artemether/Lumefantrine', 'Artemether-Lumefantrine (Coartem)'])(
    'warns about quinine with %s',
    name => expect(checkNewPrescription('Quinine', [name]).highestSeverity).toBe('serious'),
  );

  it('reads the British spelling and the combined penicillin', () => {
    expect(checkNewPrescription('Gentamicin', ['Magnesium sulphate']).highestSeverity).toBe('serious');
    expect(checkNewPrescription('Warfarin', ['Augmentin']).hasInteractions).toBe(true);
  });

  it.each(['Cotrimoxazole', 'Ciprofloxacin', 'Fluconazole', 'Rifampicin', 'Aspirin', 'Ibuprofen', 'Diclofenac'])(
    'warns about warfarin with %s',
    name => expect(checkNewPrescription(name, ['Warfarin']).highestSeverity).toBe('serious'),
  );

  it.each(['Ibuprofen', 'Diclofenac', 'Aspirin'])('warns about methotrexate with %s', name => {
    expect(checkNewPrescription(name, ['Methotrexate']).highestSeverity).toBe('serious');
  });
});

describe('isMedicationCurrent', () => {
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  const longAgo = daysAgo(ONGOING_COURSE_LOOKBACK_DAYS - 5);

  it.each(['Ongoing', 'long term', 'Long-term', 'lifelong', 'life-long', 'continuous', 'chronic'])(
    'keeps a dispensed medicine marked %s',
    duration => expect(isMedicationCurrent({ status: 'dispensed', duration, dispensedAt: longAgo })).toBe(true),
  );

  it('lets an ongoing medicine go once it has not been dispensed for the whole window', () => {
    const past = daysAgo(ONGOING_COURSE_LOOKBACK_DAYS + 5);
    expect(isMedicationCurrent({ status: 'dispensed', duration: 'ongoing', dispensedAt: past })).toBe(false);
  });

  it('still ends a finished course and an unreadable one', () => {
    expect(isMedicationCurrent({ status: 'dispensed', duration: '5 days', dispensedAt: longAgo })).toBe(false);
    expect(isMedicationCurrent({ status: 'dispensed', duration: 'as directed', dispensedAt: longAgo })).toBe(false);
  });

  it('never keeps a discontinued medicine', () => {
    expect(isMedicationCurrent({ status: 'discontinued', duration: 'ongoing', dispensedAt: longAgo })).toBe(false);
  });
});

describe('allergy classes', () => {
  it.each([
    ['NSAID', 'Ketorolac'], ['NSAID', 'Mefenamic acid'], ['NSAID', 'Celecoxib'],
    ['Cephalosporin', 'Cefazolin'], ['Cephalosporin', 'Ceftazidime'],
    ['Penicillin', 'Augmentin'], ['Penicillin', 'Tazocin'], ['Sulfa', 'Septrin'], ['Sulpha', 'Bactrim'],
  ])('%s allergy flags %s', (allergy, drug) => {
    expect(checkAllergies([drug], [allergy])).toHaveLength(1);
  });

  it('ignores a blank medicine rather than flagging every allergy', () => {
    expect(checkAllergies(['   '], ['Penicillin'])).toEqual([]);
    expect(checkNewPrescription('   ', ['Warfarin']).hasInteractions).toBe(false);
    expect(checkNewPrescription('Warfarin', ['   ']).hasInteractions).toBe(false);
  });
});

describe('methotrexate frequency', () => {
  it.each(['OD', 'BD', 'daily', 'once daily'])('stops %s', frequency => {
    expect(needsWeeklyReview('Methotrexate', frequency)).toBe(true);
    expect(hasSafetyStop({ weeklyOnly: needsWeeklyReview('Methotrexate', frequency) })).toBe(true);
  });

  it.each(['Weekly', 'once weekly', 'once a week', '1/7'])('accepts %s', frequency => {
    expect(needsWeeklyReview('Methotrexate', frequency)).toBe(false);
  });

  it('leaves other medicines and an unset frequency alone', () => {
    expect(needsWeeklyReview('Metformin', 'BD')).toBe(false);
    expect(needsWeeklyReview('Methotrexate', '')).toBe(false);
  });
});

describe('unreviewedInteractionConflicts', () => {
  const warning = { drug1: 'rifampicin', drug2: 'lopinavir', severity: 'contraindicated' as const, description: '', clinicalAdvice: '' };
  const safety = { assessedAt: '', allergyWarnings: [], interactionWarnings: [warning], duplicateWarnings: [] };
  const acknowledgement = { reviewedBy: 'Dr. A', reviewedAt: '', reason: 'No alternative available today' };
  const rifampicin = { medication: 'Rifampicin' };

  it('stops a pair nobody answered', () => {
    expect(unreviewedInteractionConflicts(rifampicin, ['Lopinavir + ritonavir'])).toEqual(['rifampicin + lopinavir']);
  });

  it('accepts the prescriber answering it on this order or on the other half', () => {
    expect(unreviewedInteractionConflicts({ ...rifampicin, medicationSafety: { ...safety, acknowledgement } }, ['Lopinavir + ritonavir'])).toEqual([]);
    expect(unreviewedInteractionConflicts(rifampicin, ['Lopinavir + ritonavir'], [{ medicationSafety: { ...safety, acknowledgement } }])).toEqual([]);
  });

  it('does not count a warning nobody justified', () => {
    expect(unreviewedInteractionConflicts(rifampicin, ['Lopinavir + ritonavir'], [{ medicationSafety: safety }])).toHaveLength(1);
  });

  it('accepts an earlier fill answering it', () => {
    const review = { allergies: [], interactions: ['rifampicin + lopinavir'], reviewedBy: 'P', reviewedAt: '', reason: 'Confirmed by phone' };
    expect(unreviewedInteractionConflicts({ ...rifampicin, dispenseAllergyReview: review }, ['Lopinavir + ritonavir'])).toEqual([]);
  });

  it('ignores anything below contraindicated', () => {
    expect(unreviewedInteractionConflicts({ medication: 'Ibuprofen' }, ['Warfarin'])).toEqual([]);
  });
});
