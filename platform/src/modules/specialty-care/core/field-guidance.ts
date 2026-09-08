import type { SpecialtyFieldDefinition } from './types';

// These are documentation aids, not diagnostic rules or treatment defaults.
// Source lineage is recorded on each parent pathway in the catalogue.
const GUIDANCE: Readonly<Record<string, Partial<SpecialtyFieldDefinition>>> = {
  chairId: { help: 'Enter the allocated chair or station identifier from the facility schedule.' },
  machineId: { referenceSource: 'assets', help: 'Choose a facility asset; verify its maintenance and readiness before treatment.' },
  deviceId: { referenceSource: 'assets', help: 'Choose the device used for acquisition from facility equipment.' },
  surgeon: { referenceSource: 'staff' }, anaesthesiaProvider: { referenceSource: 'staff' },
  nursingLead: { referenceSource: 'staff' }, acquiredBy: { referenceSource: 'staff' },
  reportSignedBy: { referenceSource: 'staff' }, prescriber: { referenceSource: 'staff' },
  preWeightKg: { step: 0.01 }, postWeightKg: { step: 0.01 }, weightKg: { step: 0.01 },
  ageMonths: { step: 1, help: 'Completed months at this visit; use the registered date of birth when known.' },
  iopRight: { step: 0.1 }, iopLeft: { step: 0.1 },
  preBloodPressure: { unit: 'mmHg', help: 'Record systolic/diastolic pressure, for example 120/80, and relevant measurement conditions.' },
  postBloodPressure: { unit: 'mmHg', help: 'Record systolic/diastolic pressure, for example 120/80, and relevant measurement conditions.' },
  toothFindings: { help: 'For each tooth record the selected notation, surface, finding, and supporting investigation.' },
  localAnaesthetic: { help: 'Record medicine, concentration, dose with unit, route, administration time and batch; do not use a default dose.' },
  procedureCodes: { help: 'Use locally approved procedure codes and describe each procedure actually performed.' },
  implantTraceability: { help: 'Record implant name, manufacturer, lot/serial and site, or explicitly mark not applicable.' },
  visualAcuityRight: { suggestions: ['6/6', '6/9', '6/12', '6/18', '6/24', '6/36', '6/60', 'Counting fingers', 'Hand movements', 'Light perception', 'No light perception', 'Unable to assess'], help: 'Record chart/notation, test distance, correction and pinhole status. Suggestions are examples, not the full scale.' },
  visualAcuityLeft: { suggestions: ['6/6', '6/9', '6/12', '6/18', '6/24', '6/36', '6/60', 'Counting fingers', 'Hand movements', 'Light perception', 'No light perception', 'Unable to assess'], help: 'Use the same measurement conditions as the right eye and document any difference.' },
  rightLens: { help: 'Record sphere, cylinder and addition in dioptres; axis 0–180 degrees; prism amount and base (up, down, in, out). Identify glasses versus contact lenses.' },
  leftLens: { help: 'Record sphere, cylinder and addition in dioptres; axis 0–180 degrees; prism amount and base (up, down, in, out). Identify glasses versus contact lenses.' },
  bodySites: { suggestions: ['Scalp', 'Face', 'Neck', 'Trunk', 'Upper limb', 'Lower limb', 'Hands', 'Feet', 'Nails', 'Mucosa', 'Generalized'], help: 'Specify the exact site, laterality and distribution; add sites not covered by the suggestions.' },
  morphology: { suggestions: ['Macule', 'Patch', 'Papule', 'Plaque', 'Nodule', 'Vesicle', 'Bulla', 'Pustule', 'Scale', 'Crust', 'Erosion', 'Ulcer'], help: 'Describe primary and secondary lesions, colour, size, border and distribution. These are findings, not diagnoses.' },
  outcomeMeasure: { help: 'Name the locally approved measure, version, scoring range, unit and direction of improvement; use the same measure at follow-up.' },
  baselineScore: { step: 'any', help: 'Use the selected measure’s scoring rules. Do not compare scores from different measures or versions.' },
  followUpScore: { step: 'any', help: 'Repeat the baseline measure and version; document measurement date and conditions.' },
  etatDangerSigns: { exclusiveOptions: ['none'], help: 'Select all observed signs. “None identified” cannot be combined with a danger sign. Document immediate action separately.' },
  referralDisposition: { suggestions: ['Follow-up at this facility', 'Specialist referral', 'Emergency referral', 'Inpatient admission', 'Community follow-up', 'Declined referral'], help: 'Record destination, urgency, receiving service and arrangements where referral is needed.' },
  gestationalAge: { help: 'Record completed weeks + days and dating basis (last menstrual period, ultrasound, or clinical estimate); mark not applicable when appropriate.' },
  structuredMeasurements: { help: 'Record test-specific measurements with units, reference context, acquisition date and limitations. Use the approved device/report template.' },
  photoDocumentIds: { help: 'Use references to consent-authorized chart images; do not paste image data or public links.' },
};

export function withFieldGuidance(field: SpecialtyFieldDefinition): SpecialtyFieldDefinition {
  return {
    ...field,
    step: field.kind === 'number' ? 'any' : undefined,
    allowNotApplicable: /not applicable/i.test(field.label),
    ...GUIDANCE[field.key],
  };
}
