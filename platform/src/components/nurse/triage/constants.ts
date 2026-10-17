/** High-prevalence chronic conditions offered as quick-pick chips. TriageDoc
 *  has no `chronicConditions` field of its own (that lives on PatientDoc, a
 *  standing record — not this visit's triage snapshot), so the selection here
 *  folds into `notes` as a clearly labelled line rather than inventing a new
 *  schema field (see the report for this limitation). */
export const TRIAGE_CHRONIC_CONDITIONS = ['HIV', 'TB', 'Diabetes', 'Hypertension', 'Sickle cell', 'Epilepsy', 'Other'] as const;

/** Why a vital could not be captured this visit — recorded as a structured
 *  note (TriageDoc has no dedicated field for this; see the report). */
export const UNMEASURED_VITAL_REASONS = [
  ['equipment_unavailable', 'Equipment unavailable'],
  ['patient_condition', 'Patient condition'],
  ['declined', 'Patient declined'],
] as const;
