/**
 * The shape of the registration form's state.
 *
 * Previously this lived only as the inferred type of a `useState` object
 * literal inside the component, and `update()` took `field: string` — so a
 * typo (`update('surnamee', …)`) silently wrote a field nothing ever read.
 * Naming the shape here lets `update` be keyed to it and lets the section
 * components take a typed `form` instead of `any`-shaped props.
 */

export type CoverageType = 'out-of-pocket' | 'program' | 'exemption' | 'ngo';

export interface RegistrationForm {
  /**
   * The facility the patient is being registered at.
   *
   * Normally implied by the clerk's own posting and never asked for. It is
   * asked — and required — only when the signed-in user carries no facility of
   * their own (a platform super_admin, an org_admin between postings), because
   * the facility is what resolves the patient's organisation, and a patient
   * with no organisation cannot be saved: CouchDB's tenant validator refuses
   * the document and every scoped role's list filters it out.
   */
  registrationFacility: string;
  firstName: string;
  middleName: string;
  surname: string;
  maidenName: string;
  dateOfBirth: string;
  estimatedAge: string;
  gender: string;
  tribe: string;
  primaryLanguage: string;
  phone: string;
  altPhone: string;
  whatsapp: string;
  email: string;
  state: string;
  county: string;
  payam: string;
  boma: string;
  bomaCode: string;
  householdNumber: string;
  address: string;
  nationalId: string;
  nokName: string;
  nokRelationship: string;
  nokPhone: string;
  nokAddress: string;
  payorCoverageType: CoverageType;
  payorProgram: string;
  payorNgo: string;
  payorExemptionReason: string;
  payorExemptionOther: string;
}

/**
 * Every field `update()` can write. Coverage type is excluded because it is
 * not a string and clearing its dependent fields is not a plain assignment —
 * it goes through `updateCoverageType`.
 */
export type RegistrationTextField = Exclude<keyof RegistrationForm, 'payorCoverageType'>;

/** An extra next-of-kin contact beyond the primary one. */
export interface AdditionalNok {
  name: string;
  relationship: string;
  phone: string;
  address: string;
}

export const EMPTY_REGISTRATION_FORM: RegistrationForm = {
  registrationFacility: '',
  firstName: '', middleName: '', surname: '', maidenName: '',
  dateOfBirth: '', estimatedAge: '', gender: '', tribe: '', primaryLanguage: '',
  phone: '', altPhone: '', whatsapp: '', email: '',
  state: '', county: '', payam: '', boma: '', bomaCode: '', householdNumber: '', address: '',
  nationalId: '',
  nokName: '', nokRelationship: '', nokPhone: '', nokAddress: '',
  payorCoverageType: 'out-of-pocket',
  payorProgram: '', payorNgo: '', payorExemptionReason: '', payorExemptionOther: '',
};

/** Relationship options for a next-of-kin contact. */
export const RELATIONSHIP_OPTIONS: { value: string; labelKey: string }[] = [
  { value: 'Spouse', labelKey: 'patientNew.relSpouse' },
  { value: 'Parent', labelKey: 'patientNew.relParent' },
  { value: 'Child', labelKey: 'patientNew.relChild' },
  { value: 'Sibling', labelKey: 'patientNew.relSibling' },
  { value: 'Uncle', labelKey: 'patientNew.relUncle' },
  { value: 'Aunt', labelKey: 'patientNew.relAunt' },
  { value: 'Cousin', labelKey: 'patientNew.relCousin' },
  { value: 'Friend', labelKey: 'patientNew.relFriend' },
  { value: 'Other', labelKey: 'patientNew.relOther' },
];

/** The most extra contacts a patient can carry beyond the primary one. */
export const MAX_ADDITIONAL_NOK = 3;

/** What every section component needs to render and report. */
export interface RegistrationSectionProps {
  form: RegistrationForm;
  errors: Record<string, string>;
  update: (field: RegistrationTextField, value: string) => void;
}
